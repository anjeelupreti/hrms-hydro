from rest_framework import serializers

from companies.models import Company


class CompanySerializer(serializers.ModelSerializer):
    parent_name = serializers.CharField(source="parent.name", read_only=True)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    project_stage_display = serializers.CharField(
        source="get_project_stage_display", read_only=True
    )
    #: How many people are on this company's payroll — the first thing anybody
    #: asks a company list for.
    #:
    #: A method field rather than a plain `IntegerField`, because the number is
    #: an annotation on the viewset's queryset and a just-created instance has
    #: never been through it. Reading the annotation where it exists keeps the
    #: list to one query; the fallback costs one more on a create response.
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = [
            "id",
            "name",
            "code",
            "legal_name",
            "kind",
            "kind_display",
            "parent",
            "parent_name",
            "registration_number",
            "pan_vat_number",
            "licence_number",
            "established_on",
            "project_stage",
            "project_stage_display",
            "installed_capacity_mw",
            "river",
            "address",
            "district",
            "province",
            "phone",
            "email",
            "website",
            "logo",
            "is_active",
            "is_primary",
            "employee_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_employee_count(self, obj):
        annotated = getattr(obj, "employee_count", None)
        if annotated is not None:
            return annotated
        return obj.primary_employees.filter(employment_status="active").count()

    def validate(self, attrs):
        # Model-level `clean` holds the real rule (self-parent, loops); calling
        # it here is what makes the API answer with a field error rather than a
        # 500 from the database or a silent save through `Model.save`, which
        # does not run validators.
        instance = Company(**{**self._instance_data(), **attrs})
        instance.pk = self.instance.pk if self.instance else None
        instance.clean()
        return attrs

    def _instance_data(self):
        if self.instance is None:
            return {}
        return {
            field.name: getattr(self.instance, field.name)
            for field in Company._meta.fields
            if field.name not in {"id"}
        }


class CompanyOptionSerializer(serializers.ModelSerializer):
    """The shape a picker needs, and nothing more.

    Employee forms offer every active company twice — once for the primary,
    once for the secondaries — and sending the full record for each would put
    the licence number and postal address of the whole group into a dropdown.
    """

    class Meta:
        model = Company
        fields = ["id", "name", "code", "kind"]
