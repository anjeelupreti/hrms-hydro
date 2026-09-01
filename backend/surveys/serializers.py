from rest_framework import serializers

from surveys.models import Survey, SurveyQuestion


class SurveyQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SurveyQuestion
        fields = ["id", "text", "kind", "choices", "order"]


class SurveySerializer(serializers.ModelSerializer):
    questions = SurveyQuestionSerializer(many=True, required=False)
    response_count = serializers.IntegerField(source="responses.count", read_only=True)

    class Meta:
        model = Survey
        fields = [
            "id", "title", "description", "status", "anonymous",
            "questions", "response_count", "created_at",
        ]
        read_only_fields = ["id", "status", "response_count", "created_at"]

    def _write_questions(self, survey, questions):
        survey.questions.all().delete()
        for i, q in enumerate(questions):
            SurveyQuestion.objects.create(
                survey=survey,
                text=q["text"],
                kind=q.get("kind", SurveyQuestion.Kind.SCALE5),
                choices=q.get("choices", []),
                order=q.get("order", i),
                created_by=survey.created_by,
                updated_by=survey.updated_by,
            )

    def create(self, validated_data):
        questions = validated_data.pop("questions", [])
        survey = Survey.objects.create(**validated_data)
        self._write_questions(survey, questions)
        return survey

    def update(self, instance, validated_data):
        questions = validated_data.pop("questions", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if questions is not None:
            self._write_questions(instance, questions)
        return instance
