from rest_framework import serializers

from goals.models import KeyResult, Objective


class KeyResultSerializer(serializers.ModelSerializer):
    progress = serializers.IntegerField(read_only=True)

    class Meta:
        model = KeyResult
        fields = [
            "id", "title", "start_value", "target_value", "current_value",
            "unit", "order", "progress",
        ]


class ObjectiveSerializer(serializers.ModelSerializer):
    key_results = KeyResultSerializer(many=True, required=False)
    progress = serializers.IntegerField(read_only=True)
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = Objective
        fields = [
            "id", "owner", "owner_name", "title", "description", "period",
            "status", "key_results", "progress", "created_at",
        ]
        read_only_fields = ["id", "owner_name", "progress", "created_at"]

    def get_owner_name(self, obj):
        if obj.owner is None:
            return "Company"
        return obj.owner.user.get_full_name() or obj.owner.user.get_username()

    def _write_krs(self, objective, krs):
        objective.key_results.all().delete()
        for i, kr in enumerate(krs):
            KeyResult.objects.create(
                objective=objective,
                title=kr["title"],
                start_value=kr.get("start_value", 0),
                target_value=kr.get("target_value", 100),
                current_value=kr.get("current_value", 0),
                unit=kr.get("unit", ""),
                order=kr.get("order", i),
                created_by=objective.created_by,
                updated_by=objective.updated_by,
            )

    def create(self, validated_data):
        krs = validated_data.pop("key_results", [])
        objective = Objective.objects.create(**validated_data)
        self._write_krs(objective, krs)
        return objective

    def update(self, instance, validated_data):
        krs = validated_data.pop("key_results", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if krs is not None:
            self._write_krs(instance, krs)
        return instance
