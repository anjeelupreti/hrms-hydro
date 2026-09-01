from django.db.models import Count
from django.http import FileResponse
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.permissions import IsHRAdmin, IsHRAdminOrReadOnly
from core.exports import XlsxExportMixin
from core.viewsets import AuditViewSetMixin
from recruitment.hiring import (
    HiringError,
    accept_offer,
    convert_candidate_to_employee,
    decline_offer,
)
from recruitment.models import Candidate, CandidateNote, JobPosting, Offer

#: A CV, not a video. Large enough for a designer's PDF portfolio and small
#: enough that an anonymous endpoint cannot be used as free file storage.
MAX_RESUME_BYTES = 5 * 1024 * 1024


class JobApplicationThrottle(ScopedRateThrottle):
    """The rate for the one endpoint here that anybody on the internet can post to.

    A named class rather than `throttle_scope` on the `@action`: DRF validates
    action kwargs against attributes the viewset already has, and
    `throttle_scope` is not one of them — passing it raises
    `TypeError: received an invalid keyword` at import, taking the whole URL
    conf down. The scope lives here instead, where it is also easier to find
    than a keyword three lines into a decorator.
    """

    scope = "job_application"
from recruitment.serializers import (
    CandidateNoteSerializer,
    CandidateSerializer,
    JobPostingSerializer,
    OfferSerializer,
)
from core.archiving import ArchiveMixin


class JobPostingViewSet(ArchiveMixin, XlsxExportMixin, AuditViewSetMixin, ModelViewSet):
    """Read-open (an internal job board); only HR writes."""

    serializer_class = JobPostingSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by role, place or wording of the advert.
    search_fields = ["title", "description", "location"]
    filterset_fields = ["status", "department", "employment_type"]

    export_filename = "job-postings.xlsx"
    export_title = "Job Postings"
    export_headers = ["Title", "Department", "Location", "Type", "Status", "Openings", "Applicants"]
    export_highlight_header = "Status"
    export_validations = {"Status": ["Draft", "Open", "Closed"]}

    def get_export_rows(self, queryset):
        return [
            [
                j.title,
                j.department.name if j.department else "",
                j.location,
                j.get_employment_type_display(),
                j.get_status_display(),
                j.openings,
                j.candidates.count(),
            ]
            for j in queryset
        ]

    def get_queryset(self):
        return JobPosting.objects.select_related("department").prefetch_related("candidates")

    @action(detail=False, methods=["get"])
    def summary(self, request, **kwargs):
        stage_rows = Candidate.objects.values("stage").annotate(c=Count("id"))
        return Response(
            {
                "open_positions": JobPosting.objects.filter(status=JobPosting.Status.OPEN).count(),
                "total_candidates": Candidate.objects.count(),
                "hired": Candidate.objects.filter(stage=Candidate.Stage.HIRED).count(),
                "by_stage": {row["stage"]: row["c"] for row in stage_rows},
            }
        )

    @action(detail=False, methods=["get"], permission_classes=[AllowAny])
    def public(self, request, **kwargs):
        """The workspace's job board, for people who do not have an account.

        **Open and not archived** — both, because `status` and `archived_at`
        are independent and a filled role is usually archived rather than
        reopened as something else. Testing only one would leave a posting the
        company had taken down still collecting applications.

        The fields are chosen rather than serialized: this is the one endpoint
        in the module that answers without authentication, and a serializer
        gaining a field later must not gain it here too. Salary, the hiring
        manager and the candidate pipeline are deliberately absent.
        """
        jobs = (
            JobPosting.objects.filter(status=JobPosting.Status.OPEN, archived_at__isnull=True)
            .select_related("department")
            .order_by("-created_at")
        )
        return Response(
            [
                {
                    "id": j.id,
                    "title": j.title,
                    "department": j.department.name if j.department else None,
                    "location": j.location,
                    "employment_type": j.get_employment_type_display(),
                    "description": j.description,
                    "posted_on": j.created_at.date().isoformat() if j.created_at else None,
                }
                for j in jobs
            ]
        )

    @action(detail=False, methods=["get"], url_path="public-company", permission_classes=[AllowAny])
    def public_company(self, request, **kwargs):
        """Who is hiring — for the header of the public job board.

        A job board that does not say whose jobs these are is not a job board.
        The careers page had no company name on it at all, because nothing
        unauthenticated could tell it one.

        **Three fields, chosen individually.** `CompanyProfile` holds the PAN,
        the bank details and the SMTP password; this is served to anybody who
        asks, so it names what it returns rather than excluding what it must
        not. The logo goes out as the gated `/media/` path like every other
        upload — the file itself is still served through `core.media`.
        """
        from organization.models import CompanyProfile

        profile = CompanyProfile.get_solo()
        return Response(
            {
                "name": profile.name,
                "logo_url": f"/media/{profile.logo.name}" if profile.logo else None,
                "address": profile.address,
            }
        )

    @action(
        detail=True,
        methods=["post"],
        url_path="apply",
        permission_classes=[AllowAny],
        parser_classes=[MultiPartParser, FormParser],
        throttle_classes=[JobApplicationThrottle],
    )
    def apply(self, request, pk=None, **kwargs):
        """Somebody applies for a job, without an account.

        The endpoint behind the careers page's Apply button.

        **The candidate supplies four things and decides nothing.** `stage`,
        `rating` and `source` are set here, not read from the request: a
        `CandidateSerializer` bound to this input would let an applicant post
        themselves in at `offer` with five stars. That is the same shape as
        every other "an API accepts a field it should not" bug found this
        month, and this endpoint is the one where the poster is anonymous.

        Only for a job that is actually open and not archived — the same
        condition the public list uses, so a link kept from last month cannot
        submit into a closed role.
        """
        job = JobPosting.objects.filter(
            pk=pk, status=JobPosting.Status.OPEN, archived_at__isnull=True
        ).first()
        if job is None:
            # Not 403: whether a closed job exists is not a stranger's business.
            return Response({"detail": "This role is no longer open."}, status=404)

        name = (request.data.get("name") or "").strip()
        email = (request.data.get("email") or "").strip()
        if not name or not email:
            return Response({"detail": "Your name and email are required."}, status=400)

        resume = request.FILES.get("resume")
        if resume is not None and resume.size > MAX_RESUME_BYTES:
            return Response(
                {"detail": f"Attach a file under {MAX_RESUME_BYTES // (1024 * 1024)} MB."},
                status=400,
            )

        candidate = Candidate.objects.create(
            job=job,
            name=name[:150],
            email=email[:254],
            phone=(request.data.get("phone") or "").strip()[:20],
            resume=resume,
            stage=Candidate.Stage.APPLIED,
            source="Careers page",
        )
        return Response({"id": candidate.id, "job": job.title}, status=201)


class CandidateViewSet(XlsxExportMixin, AuditViewSetMixin, ModelViewSet):
    """Confidential hiring pipeline — HR admins only. Moving a card between
    pipeline columns is a PATCH to `stage`; rating is a PATCH to `rating`."""

    serializer_class = CandidateSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by the person, how to reach them, or the role applied for.
    search_fields = ["name", "email", "phone", "source", "job__title"]
    filterset_fields = ["job", "stage"]

    export_filename = "candidates.xlsx"
    export_title = "Candidates"
    export_headers = ["Name", "Job", "Stage", "Rating", "Source", "Email", "Phone"]
    export_highlight_header = "Stage"
    export_validations = {"Stage": ["Applied", "Screening", "Interview", "Offer", "Hired", "Rejected"]}

    @action(detail=True, methods=["post"], url_path="convert-to-employee")
    def convert_to_employee(self, request, *args, **kwargs):
        """Create the login and employee record for a hired candidate.

        The link that was missing entirely: `Stage.HIRED` existed and nothing
        acted on it, so somebody was hired in the product and then typed into it
        again by hand.
        """
        candidate = self.get_object()
        try:
            employee, checklist = convert_candidate_to_employee(candidate, actor=request.user)
        except HiringError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        return Response({
            "employee_id": employee.id,
            "employee_code": employee.employee_code,
            "username": employee.user.username,
            "email": employee.user.email,
            "onboarding_checklist_id": checklist.id if checklist else None,
            "onboarding_tasks": checklist.tasks.count() if checklist else 0,
        }, status=status.HTTP_201_CREATED)

    def get_export_rows(self, queryset):
        return [
            [
                c.name,
                c.job.title,
                c.get_stage_display(),
                c.rating if c.rating is not None else "",
                c.source,
                c.email,
                c.phone,
            ]
            for c in queryset
        ]

    def get_queryset(self):
        # `offer` joined, not fetched per row: the pipeline shows offer status on
        # every card, and without this that is one query per candidate.
        return Candidate.objects.select_related("job", "offer").prefetch_related("notes")

    @action(detail=True, methods=["get", "post"])
    def notes(self, request, pk=None, **kwargs):
        candidate = self.get_object()
        if request.method == "POST":
            body = (request.data.get("body") or "").strip()
            if not body:
                return Response({"detail": "Note body required."}, status=status.HTTP_400_BAD_REQUEST)
            note = CandidateNote.objects.create(candidate=candidate, body=body, author=request.user)
            return Response(CandidateNoteSerializer(note).data, status=status.HTTP_201_CREATED)
        return Response(CandidateNoteSerializer(candidate.notes.all(), many=True).data)

    @action(detail=True, methods=["get"])
    def resume(self, request, pk=None, **kwargs):
        candidate = self.get_object()
        if not candidate.resume:
            return Response(status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(candidate.resume.open("rb"))
        response["Content-Disposition"] = f'inline; filename="{candidate.name}-resume"'
        return response


class OfferViewSet(AuditViewSetMixin, ModelViewSet):
    """Offers, and the candidate's answer to them.

    HR-only. Extending an offer and recording its answer are both hiring
    decisions, not something a candidate-facing surface should reach.
    """

    serializer_class = OfferSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by who the offer is to.
    search_fields = ["candidate__name", "candidate__email"]
    filterset_fields = ["status", "candidate"]

    def get_queryset(self):
        return Offer.objects.select_related("candidate", "designation", "department")

    @action(detail=True, methods=["post"])
    def send(self, request, *args, **kwargs):
        offer = self.get_object()
        if not offer.is_open:
            return Response(
                {"detail": f"This offer is {offer.get_status_display().lower()}."},
                status=status.HTTP_409_CONFLICT,
            )
        # The token is minted here rather than at creation, so a draft that is
        # edited and re-edited never has a live link, and `issue_response_token`
        # is idempotent so a resend reaches the same URL as the first email —
        # which is what somebody forwarding "did you get this?" is looking at.
        offer.issue_response_token()
        offer.status = Offer.Status.SENT
        offer.sent_at = timezone.now()
        offer.updated_by = request.user
        offer.save(update_fields=[
            "response_token", "status", "sent_at", "updated_by", "updated_at",
        ])

        from recruitment.offer_response import send_offer_email

        emailed = send_offer_email(offer, request=request)
        data = self.get_serializer(offer).data
        # Reported rather than assumed. A candidate with no email address on
        # file is a real case, and the screen has to say so — otherwise HR
        # waits for a reply to a message that was never addressed.
        data["emailed"] = emailed
        return Response(data)

    @action(detail=True, methods=["post"])
    def accept(self, request, *args, **kwargs):
        """The candidate said yes. This is what "hired" means.

        Converting to an employee is a separate call, so that agreeing and
        provisioning stay distinct events — an offer accepted in November for a
        March start should not create a login in November.
        """
        offer = self.get_object()
        try:
            offer = accept_offer(offer, actor=request.user)
        except HiringError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(offer).data)

    @action(detail=True, methods=["post"])
    def decline(self, request, *args, **kwargs):
        """They said no — recorded as a decline, not a rejection."""
        offer = self.get_object()
        try:
            offer = decline_offer(
                offer, reason=(request.data.get("reason") or "").strip(), actor=request.user
            )
        except HiringError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(offer).data)
