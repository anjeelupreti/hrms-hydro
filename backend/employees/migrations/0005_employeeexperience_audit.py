"""Give `EmployeeExperience` the who/when trail every HR-written record has.

Written by hand rather than generated, because `auto_now_add` on `created_at`
has to be given something for the rows that already exist and the generator can
only ask interactively. `timezone.now` is the honest answer: these entries were
created at some point nobody recorded, and stamping them with the migration's
own run time says "we started counting here" rather than inventing a date.
"""

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("employees", "0004_employee_blood_group_employee_office_email_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="employeeexperience",
            name="created_at",
            field=models.DateTimeField(
                auto_now_add=True, default=django.utils.timezone.now
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="employeeexperience",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AddField(
            model_name="employeeexperience",
            name="created_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="employeeexperience",
            name="updated_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
