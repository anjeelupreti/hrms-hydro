from datetime import date

from rest_framework import serializers

from recruitment.models import Candidate, CandidateNote, JobPosting, Offer


class JobPostingSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    candidate_count = serializers.IntegerField(source="candidates.count", read_only=True)

    class Meta:
        model = JobPosting
        fields = [
            "id",
            "title",
            "department",
            "department_name",
            "location",
            "employment_type",
            "status",
            "description",
            "openings",
            "salary_min",
            "salary_max",
            "candidate_count",
            "created_at",
        ]


class CandidateNoteSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = CandidateNote
        fields = ["id", "body", "author_name", "created_at"]
        read_only_fields = ["id", "author_name", "created_at"]

    def get_author_name(self, obj):
        if obj.author is None:
            return None
        return obj.author.get_full_name() or obj.author.get_username()


class CandidateSerializer(serializers.ModelSerializer):
    job_title = serializers.CharField(source="job.title", read_only=True)
    note_count = serializers.IntegerField(source="notes.count", read_only=True)
    has_resume = serializers.SerializerMethodField()
    resume = serializers.FileField(required=False, allow_null=True, write_only=True)
    # Carried on the candidate so a pipeline board can show who has accepted
    # without opening each card — the alternative is one request per card, which
    # is the shape of bug the shared primitives exist to prevent. `Offer` is a
    # OneToOne, so this costs a `select_related`, not a query per row.
    offer_status = serializers.SerializerMethodField()
    offer_expires_on = serializers.SerializerMethodField()
    #: Days until the offer lapses — **served, not derived in the browser.**
    #: Same reasoning as `Offer.is_open`: a client comparing a date against its
    #: own clock disagrees with the server about what has expired, and it also
    #: makes the card impure to render. Negative means already lapsed.
    offer_expires_in_days = serializers.SerializerMethodField()

    class Meta:
        model = Candidate
        fields = [
            "id",
            "job",
            "job_title",
            "name",
            "email",
            "phone",
            "stage",
            "rating",
            "source",
            "interview_at",
            "resume",
            "note_count",
            "has_resume",
            "offer_status",
            "offer_expires_on",
            "offer_expires_in_days",
            "created_at",
        ]

    def get_offer_status(self, obj):
        offer = getattr(obj, "offer", None)
        return offer.status if offer else None

    def get_offer_expires_on(self, obj):
        """Shown on the card so an offer about to lapse is visible without
        opening it — the one thing about a sent offer that is time-critical."""
        offer = getattr(obj, "offer", None)
        return offer.expires_on if offer else None

    def get_offer_expires_in_days(self, obj):
        offer = getattr(obj, "offer", None)
        if offer is None or offer.expires_on is None:
            return None
        return (offer.expires_on - date.today()).days

    def get_has_resume(self, obj):
        return bool(obj.resume)


class OfferSerializer(serializers.ModelSerializer):
    candidate_name = serializers.CharField(source="candidate.name", read_only=True)
    # Whether this offer can still be answered. Served rather than derived in
    # the browser: "open" means not accepted, declined *or lapsed*, and a
    # client comparing `expires_on` against its own clock will disagree with
    # the server about the last one.
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = Offer
        fields = [
            "id", "candidate", "candidate_name", "status", "annual_salary",
            "designation", "department", "start_date", "expires_on", "notes",
            "sent_at", "responded_at", "decline_reason", "is_open",
        ]
        # Status moves only through the accept/decline/send actions, which
        # record who and when. A PATCH could set it to accepted with no
        # acceptance behind it, which is the thing this model exists to prevent.
        read_only_fields = ["id", "status", "sent_at", "responded_at", "decline_reason"]
