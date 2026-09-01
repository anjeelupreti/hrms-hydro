from django.db import models

from core.models import AuditModel
from core.archiving import ArchivableModel


class Survey(ArchivableModel, AuditModel):
    """A pulse survey or eNPS poll. Questions are nested; responses are
    collected while `active`. `anonymous` drops the respondent link (still
    one response per employee is enforced to curb ballot-stuffing)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    anonymous = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class SurveyQuestion(AuditModel):
    class Kind(models.TextChoices):
        NPS = "nps", "eNPS (0–10)"
        SCALE5 = "scale5", "Rating (1–5)"
        TEXT = "text", "Free text"
        CHOICE = "choice", "Single choice"

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="questions")
    text = models.CharField(max_length=300)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.SCALE5)
    choices = models.JSONField(default=list, blank=True)  # for CHOICE
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text


class SurveyResponse(AuditModel):
    """One employee's submission. `respondent` is null when the survey is
    anonymous (true anonymity — no back-link). For non-anonymous surveys the
    respondent is recorded and the viewset blocks a second submission."""

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="responses")
    respondent = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="survey_responses"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"response to {self.survey_id}"


class SurveyAnswer(models.Model):
    response = models.ForeignKey(SurveyResponse, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(SurveyQuestion, on_delete=models.CASCADE, related_name="answers")
    numeric_value = models.IntegerField(null=True, blank=True)  # scale/nps/choice-index
    text_value = models.TextField(blank=True)

    def __str__(self):
        return f"answer to q{self.question_id}"
