from django.db import transaction
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from surveys.models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse
from surveys.serializers import SurveySerializer
from core.archiving import ArchiveMixin


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class SurveyViewSet(ArchiveMixin, AuditViewSetMixin, ModelViewSet):
    serializer_class = SurveySerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by what the survey asks about.
    search_fields = ["title", "description"]
    filterset_fields = ["status"]

    def get_queryset(self):
        qs = Survey.objects.prefetch_related("questions")
        if _is_hr(self.request.user):
            return qs
        # Employees only see active surveys (to respond to) — not drafts/results.
        return qs.filter(status=Survey.Status.ACTIVE)

    def _deny_if_not_hr(self, request):
        return None if _is_hr(request.user) else Response({"detail": "HR only."}, status=status.HTTP_403_FORBIDDEN)

    def create(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().create(request, *a, **k)

    def update(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().update(request, *a, **k)

    def destroy(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().destroy(request, *a, **k)

    def _set_status(self, request, new_status):
        deny = self._deny_if_not_hr(request)
        if deny:
            return deny
        survey = self.get_object()
        survey.status = new_status
        survey.save(update_fields=["status"])
        return Response(self.get_serializer(survey).data)

    @action(detail=True, methods=["post"])
    def publish(self, request, *args, **kwargs):
        return self._set_status(request, Survey.Status.ACTIVE)

    @action(detail=True, methods=["post"])
    def close(self, request, *args, **kwargs):
        return self._set_status(request, Survey.Status.CLOSED)

    @action(detail=True, methods=["get"])
    def mine(self, request, *args, **kwargs):
        """Whether the caller has already answered this active survey."""
        survey = self.get_object()
        me = _requesting_employee(request.user)
        answered = (
            not survey.anonymous
            and me is not None
            and survey.responses.filter(respondent=me).exists()
        )
        return Response({"answered": answered})

    @action(detail=True, methods=["post"])
    def respond(self, request, *args, **kwargs):
        survey = self.get_object()
        if survey.status != Survey.Status.ACTIVE:
            return Response({"detail": "This survey isn't open."}, status=400)
        me = _requesting_employee(request.user)
        if not survey.anonymous and me is not None and survey.responses.filter(respondent=me).exists():
            return Response({"detail": "You've already responded."}, status=400)

        answers = request.data.get("answers") or []
        valid_qids = set(survey.questions.values_list("id", flat=True))
        with transaction.atomic():
            resp = SurveyResponse.objects.create(
                survey=survey,
                respondent=None if survey.anonymous else me,
                created_by=request.user,
                updated_by=request.user,
            )
            for a in answers:
                qid = a.get("question")
                if qid not in valid_qids:
                    continue
                SurveyAnswer.objects.create(
                    response=resp,
                    question_id=qid,
                    numeric_value=a.get("numeric_value"),
                    text_value=a.get("text_value", "") or "",
                )
        return Response({"detail": "Thanks for your response."}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def results(self, request, *args, **kwargs):
        deny = self._deny_if_not_hr(request)
        if deny:
            return deny
        survey = self.get_object()
        out = []
        for q in survey.questions.all():
            answers = list(q.answers.all())
            nums = [a.numeric_value for a in answers if a.numeric_value is not None]
            item = {"id": q.id, "text": q.text, "kind": q.kind, "count": len(answers)}
            if q.kind == SurveyQuestion.Kind.NPS:
                total = len(nums)
                promoters = sum(1 for n in nums if n >= 9)
                detractors = sum(1 for n in nums if n <= 6)
                item["nps"] = round((promoters - detractors) / total * 100) if total else 0
                item["promoters"] = promoters
                item["passives"] = sum(1 for n in nums if 7 <= n <= 8)
                item["detractors"] = detractors
            elif q.kind == SurveyQuestion.Kind.SCALE5:
                item["average"] = round(sum(nums) / len(nums), 2) if nums else 0
            elif q.kind == SurveyQuestion.Kind.CHOICE:
                counts = {}
                for n in nums:
                    label = q.choices[n] if 0 <= n < len(q.choices) else str(n)
                    counts[label] = counts.get(label, 0) + 1
                item["counts"] = counts
            else:  # TEXT
                item["answers"] = [a.text_value for a in answers if a.text_value]
            out.append(item)
        return Response({"response_count": survey.responses.count(), "questions": out})
