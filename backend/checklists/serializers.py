from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from checklists.models import (
    Checklist,
    ChecklistTask,
    ChecklistTemplate,
    ChecklistTemplateItem,
)


def _emp_name(emp):
    if emp is None:
        return None
    return emp.user.get_full_name() or emp.user.get_username()


class ChecklistTemplateItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChecklistTemplateItem
        fields = ["id", "title", "description", "order", "due_offset_days"]


class ChecklistTemplateSerializer(serializers.ModelSerializer):
    items = ChecklistTemplateItemSerializer(many=True, required=False)
    item_count = serializers.IntegerField(source="items.count", read_only=True)

    class Meta:
        model = ChecklistTemplate
        fields = ["id", "name", "kind", "description", "is_active", "items", "item_count", "created_at"]
        read_only_fields = ["id", "item_count", "created_at"]

    def _write_items(self, template, items):
        template.items.all().delete()
        for i, item in enumerate(items):
            ChecklistTemplateItem.objects.create(
                template=template,
                title=item["title"],
                description=item.get("description", ""),
                order=item.get("order", i),
                due_offset_days=item.get("due_offset_days", 0),
                created_by=template.created_by,
                updated_by=template.updated_by,
            )

    def create(self, validated_data):
        items = validated_data.pop("items", [])
        template = ChecklistTemplate.objects.create(**validated_data)
        self._write_items(template, items)
        return template

    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if items is not None:
            self._write_items(instance, items)
        return instance


class ChecklistTaskSerializer(serializers.ModelSerializer):
    assignee_name = serializers.SerializerMethodField()

    class Meta:
        model = ChecklistTask
        fields = [
            "id", "title", "description", "order", "assignee", "assignee_name",
            "due_date", "status", "completed_at",
        ]
        read_only_fields = ["id", "assignee_name", "completed_at"]

    def get_assignee_name(self, obj):
        return _emp_name(obj.assignee)


class ChecklistSerializer(serializers.ModelSerializer):
    tasks = ChecklistTaskSerializer(many=True, read_only=True)
    employee_name = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    # Optional: with a template, title/kind default from it.
    title = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Checklist
        fields = [
            "id", "employee", "employee_name", "kind", "template", "title",
            "status", "tasks", "progress", "created_at",
        ]
        read_only_fields = ["id", "employee_name", "tasks", "progress", "status", "created_at"]

    def get_employee_name(self, obj):
        return _emp_name(obj.employee)

    def get_progress(self, obj):
        tasks = obj.tasks.all()
        total = len(tasks)
        done = sum(1 for t in tasks if t.status == ChecklistTask.Status.DONE)
        return {"done": done, "total": total, "pct": round(100 * done / total) if total else 0}

    def validate(self, attrs):
        if not attrs.get("template") and not (attrs.get("title") or "").strip():
            raise serializers.ValidationError({"title": "Required when no template is chosen."})
        return attrs

    def create(self, validated_data):
        """Instantiate a checklist for an employee. When a template is given,
        copy its items into task rows (due_date = today + offset). created_by/
        updated_by are already injected by AuditViewSetMixin.perform_create."""
        template = validated_data.get("template")
        if template is not None:
            if not validated_data.get("kind"):
                validated_data["kind"] = template.kind
            if not (validated_data.get("title") or "").strip():
                validated_data["title"] = template.name
        checklist = Checklist.objects.create(**validated_data)
        if template is not None:
            today = timezone.localdate()
            for item in template.items.all():
                ChecklistTask.objects.create(
                    checklist=checklist,
                    title=item.title,
                    description=item.description,
                    order=item.order,
                    due_date=today + timedelta(days=item.due_offset_days),
                    created_by=checklist.created_by,
                    updated_by=checklist.updated_by,
                )
        return checklist


class MyChecklistTaskSerializer(serializers.ModelSerializer):
    """A person's assigned checklist tasks — flattened with the employee +
    checklist context for the 'my tasks' queue."""

    checklist_id = serializers.IntegerField(source="checklist.id", read_only=True)
    checklist_title = serializers.CharField(source="checklist.title", read_only=True)
    for_employee = serializers.SerializerMethodField()

    class Meta:
        model = ChecklistTask
        fields = [
            "id", "title", "description", "due_date", "status",
            "checklist_id", "checklist_title", "for_employee",
        ]
        read_only_fields = fields

    def get_for_employee(self, obj):
        return _emp_name(obj.checklist.employee)
