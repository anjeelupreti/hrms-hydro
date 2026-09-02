"""Seed a hydropower **group**, and everything this fork added.

    python manage.py seed_hydro

**Why this exists beside `seed_demo` rather than replacing it.** `seed_demo`
already builds a convincing single company — eight departments, sixty people,
a year of attendance, leave balances, payroll structures, training, recruitment
and a CRM pipeline. Rewriting all of that to add companies and memoranda would
be copying nine hundred lines to change forty. So this runs it first and then
layers on what the SaaS product never had:

* the **group**: a holding company and three project companies, and every
  employee attached to one with a couple of secondments across them;
* **corporate posts and roles**, which are not job titles;
* **memoranda** in every state the chain can be in — drafted, halfway up,
  sent back, approved, rejected — because a workflow with no in-flight examples
  is one nobody can see working;
* **field visits**, including one covering today so the attendance seam is
  visible;
* suspensions, awards, disciplinary actions, events, expense budgets and asset
  history.

**Idempotent-ish.** Everything is keyed on a natural identifier — a company
code, an employee code, a memorandum subject — so a second run tops up rather
than duplicating. It is still a demo seed: never wire it into production
startup.

🔒 **Every person is invented.** The project facts below are the published ones
for real Nepali hydropower companies; the staff, their pay, their appraisals and
above all their disciplinary records are fiction. Real names attached to
invented misconduct would not be a demo.
"""

import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from accounts.policy import set_role
from assets.history import record as record_asset_event
from assets.models import Asset, AssetEvent
from companies.models import Company
from employees.models import (
    Award,
    CorporatePost,
    CorporateRole,
    DisciplinaryAction,
    Employee,
    EmployeeExperience,
)
from employees.suspensions import suspend
from events.models import Event, EventStakeholder
from expenses.models import ExpenseBudget
from fieldvisits.models import FieldVisit, FieldVisitParticipant
from fieldvisits.services import decide as decide_visit
from fieldvisits.services import request_visit
from helpdesk.models import Ticket
from memoranda.models import Memorandum, MemorandumAction
from memoranda.workflow import proceed, resubmit, send_back, set_chain, submit
from memoranda.workflow import decide as decide_memo
from payroll.models import StatutoryRate, TaxSlab

# ── The group ────────────────────────────────────────────────────────────
#
# One holding company and three project companies, which is the ordinary shape
# in this sector: the licence, the balance sheet and the board are per project,
# and the people are shared. Capacities and rivers are real Nepali projects; the
# corporate structure around them is composed for the demo.

COMPANIES = [
    {
        "name": "Vision Lumbini Urja Company Limited",
        "code": "VLUCL",
        "kind": Company.Kind.PARENT,
        "project_stage": Company.ProjectStage.NOT_APPLICABLE,
        "address": "Butwal-8, Rupandehi",
        "district": "Rupandehi",
        "province": "Lumbini",
        "registration_number": "148372/074/075",
        "pan_vat_number": "609481523",
        "established_on": date(2018, 4, 12),
    },
    {
        "name": "Seti Nadi Hydropower Limited",
        "code": "SNHL",
        "kind": Company.Kind.SPV,
        "project_stage": Company.ProjectStage.OPERATION,
        "installed_capacity_mw": Decimal("25.000"),
        "river": "Seti Nadi",
        "district": "Kaski",
        "province": "Gandaki",
        "licence_number": "GEN-1142-075",
        "established_on": date(2018, 9, 3),
    },
    {
        "name": "Sanjen Jalavidyut Company Limited",
        "code": "SJCL",
        "kind": Company.Kind.SPV,
        "project_stage": Company.ProjectStage.CONSTRUCTION,
        "installed_capacity_mw": Decimal("42.500"),
        "river": "Sanjen Khola",
        "district": "Rasuwa",
        "province": "Bagmati",
        "licence_number": "GEN-1387-078",
        "established_on": date(2021, 2, 17),
    },
    {
        "name": "Marsyangdi Corridor Transmission Limited",
        "code": "MCTL",
        "kind": Company.Kind.SUBSIDIARY,
        "project_stage": Company.ProjectStage.LICENSED,
        "river": "Marsyangdi",
        "district": "Lamjung",
        "province": "Gandaki",
        "established_on": date(2022, 11, 8),
    },
]

# ── Post and role, which are not job titles ──────────────────────────────
#
# The post is the chair somebody is appointed to and what their grade follows;
# the role is what they are responsible for. Rank 1 is the top.

POSTS = [
    ("Chief Executive Officer", "CEO", 1),
    ("Deputy General Manager", "DGM", 2),
    ("Manager", "MGR", 3),
    ("Deputy Manager", "DYM", 4),
    ("Senior Officer", "SO", 5),
    ("Officer", "OFF", 6),
    ("Assistant Officer", "AO", 7),
    ("Senior Assistant", "SA", 8),
    ("Assistant", "AST", 9),
]

ROLES = [
    ("Head, Plant Operations", "HPO", "SNHL"),
    ("Head, Civil Works", "HCW", "SJCL"),
    ("Head, Electrical & Transmission", "HET", None),
    ("Project Manager, Sanjen", "PMS", "SJCL"),
    ("Company Secretary", "CS", "VLUCL"),
    ("Head, Finance & Accounts", "HFA", "VLUCL"),
    ("Head, Environment & Social", "HES", None),
    ("Chief, Human Resources", "CHR", "VLUCL"),
    ("Store In-charge", "SIC", "SNHL"),
]

# ── The memorandum vocabulary ────────────────────────────────────────────
#
# Configurable per organisation — this is one plausible set, and the point of
# `MemorandumAction` is that the next customer's is different.

MEMO_ACTIONS = [
    ("Recommended", "REC", "proceed", 1, False, "Supports the proposal and sends it on."),
    ("Noted", "NOTE", "proceed", 2, False, "Seen, no objection."),
    ("Reviewed", "REV", "proceed", 3, False, "Checked the substance."),
    ("Verified", "VER", "proceed", 4, False, "Figures and documents checked."),
    ("Supported", "SUP", "proceed", 5, False, "Endorsed with reasons."),
    ("Forwarded", "FWD", "proceed", 6, False, "Passed on without a view."),
    ("Returned for correction", "RET", "return", 7, True, "Sent back to be fixed."),
    ("Returned for clarification", "RETC", "return", 8, True, "Sent back with a question."),
]


class Command(BaseCommand):
    help = "Seed a hydropower group: companies, memoranda, field visits and the rest."

    def add_arguments(self, parser):
        parser.add_argument(
            "--owner-password",
            default=None,
            help=(
                "Set the owner's password so the seeded system can be logged "
                "into. Opt-in and never defaulted: the owner is created by "
                "`bootstrap_owner` with a password only the installer has, and "
                "a seed that silently reset it would hand the demo account's "
                "password to anybody who re-ran the seed on a live system."
            ),
        )
        parser.add_argument(
            "--skip-base",
            action="store_true",
            help="Do not run seed_demo first — for topping up an already-seeded database.",
        )

    def handle(self, *args, **options):
        random.seed(4)
        if options["owner_password"]:
            self._set_owner_password(options["owner_password"])
        if not options["skip_base"]:
            self.stdout.write("Running the base demo seed…")
            call_command("seed_demo")

        with transaction.atomic():
            companies = self._companies()
            posts, roles = self._posts_and_roles(companies)
            people = self._attach_people(companies, posts, roles)
            self._conduct(people)
            self._experience(people)
            self._budgets()
            self._events(companies, people)
            self._field_visits(companies, people)
            self._assets(people)
            self._helpdesk(people)
            actions = self._memo_actions()
            self._memoranda(companies, people, actions)
            self._verify_statutory()
            self._roles()

        self.stdout.write(self.style.SUCCESS("\nSeeded the hydro group."))
        self.stdout.write(f"  companies        {Company.objects.count()}")
        self.stdout.write(f"  memoranda        {Memorandum.objects.count()}")
        self.stdout.write(f"  field visits     {FieldVisit.objects.count()}")
        self.stdout.write(f"  events           {Event.objects.count()}")
        self.stdout.write(f"  awards           {Award.objects.count()}")
        self.stdout.write(f"  disciplinary     {DisciplinaryAction.objects.count()}")
        self.stdout.write(f"  expense budgets  {ExpenseBudget.objects.count()}")

    def _set_owner_password(self, password):
        """Give the owner a known password, when explicitly asked.

        `bootstrap_owner` generates one and prints it once, which is right for
        an install and useless a week later on a demo box — the account that
        can see everything is then the one account nobody can sign in as. This
        is the escape hatch, and it is a flag rather than a default for the
        obvious reason.
        """
        owner = User.objects.filter(role="owner").first()
        if owner is None:
            self.stdout.write(self.style.WARNING("  · no owner account to set a password on"))
            return
        owner.set_password(password)
        owner.save(update_fields=["password"])
        self.stdout.write(f"  · owner login: {owner.get_username()} / {password}")

    # ── Who does what ────────────────────────────────────────────────────

    def _roles(self):
        """Split the HR department into admins and officers.

        The base seed makes everybody in Human Resources an `hr_admin`, which
        leaves the distinction the product is built around — an admin *creates*
        (a new employee, a new slab, a new company), an officer *operates*
        (edits and views, never deletes) — with nobody on the officer side of
        it. A demo where the restricted role does not exist is a demo where the
        restriction is never seen, and the first person to notice it is the
        customer.

        Appointed through `accounts.policy.set_role` with the owner as the
        actor, so the seed goes through the same gate the settings page does
        rather than writing `user.role` behind it. That gate is the reason
        demoting an admin needs the owner: two admins who can demote each other
        can take turns.
        """
        owner = User.objects.filter(role="owner").first()
        if owner is None:
            self.stdout.write(self.style.WARNING("  · no owner — roles left alone"))
            return

        admins = list(
            User.objects.filter(role="hr_admin").order_by("id")
        )
        # The senior one stays an admin: somebody has to be able to add people.
        for user in admins[1:]:
            set_role(owner, user, "hr_officer")

        # Counted from the database rather than from `admins`, so a re-run —
        # where everybody has already been demoted and the loop does nothing —
        # reports what is actually there instead of "0 officers".
        self.stdout.write(
            f"  · {User.objects.filter(role='hr_admin').count()} HR admin, "
            f"{User.objects.filter(role='hr_officer').count()} HR officer(s)"
        )

    # ── Statutory figures ────────────────────────────────────────────────

    def _verify_statutory(self):
        """Mark the seeded rates and slabs as checked.

        **Why the seed does this and the app does not.** `is_verified` is the
        guard that stops a payroll run being finalised on numbers nobody has
        confirmed against the Finance Act — finalising locks the period, so the
        block is deliberate and has no override. The flag ships `False` so an
        unchecked default is visible as unchecked rather than looking
        authoritative.

        That is correct for a real deployment and fatal for a demo: without this
        step every seeded run stops at *Finalize* with a 409 naming four
        unverified tax bands, and the payroll flow cannot be walked end to end.
        So the seed does explicitly, once, and only to seeded data, what an
        accountant would do on the statutory rates page — rather than the guard
        being weakened for everybody.
        """
        rates = StatutoryRate.objects.filter(is_verified=False).update(
            is_verified=True, verified_at=timezone.now()
        )
        slabs = TaxSlab.objects.filter(is_verified=False).update(
            is_verified=True, verified_at=timezone.now()
        )
        self.stdout.write(f"  · verified {rates} rates and {slabs} tax bands")

    # ── The group ────────────────────────────────────────────────────────

    def _companies(self):
        made = {}
        for spec in COMPANIES:
            company, _ = Company.objects.update_or_create(
                code=spec["code"], defaults={k: v for k, v in spec.items() if k != "code"}
            )
            made[spec["code"]] = company
        # The group structure, set after all four exist so the parent is there
        # to point at.
        parent = made["VLUCL"]
        for code in ("SNHL", "SJCL", "MCTL"):
            made[code].parent = parent
            made[code].save(update_fields=["parent"])
        self.stdout.write(f"  · {len(made)} companies")
        return made

    def _posts_and_roles(self, companies):
        posts = {}
        for name, code, rank in POSTS:
            posts[code], _ = CorporatePost.objects.update_or_create(
                code=code, defaults={"name": name, "rank": rank}
            )
        roles = {}
        for name, code, company_code in ROLES:
            roles[code], _ = CorporateRole.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "company": companies.get(company_code) if company_code else None,
                },
            )
        self.stdout.write(f"  · {len(posts)} posts, {len(roles)} roles")
        return posts, roles

    def _attach_people(self, companies, posts, roles):
        """Give everybody a company, a post, and the contact details this fork added.

        Weighted rather than uniform: the operating plant carries most of the
        staff, the company under construction a quarter, and the holding company
        the secretariat and finance. A round-robin would produce a group whose
        headcount tells you nothing.
        """
        employees = list(
            Employee.objects.select_related("user", "department", "designation").order_by("id")
        )
        if not employees:
            self.stdout.write(self.style.WARNING("  · no employees — run without --skip-base"))
            return {}

        by_department = {
            "Plant Operations": "SNHL",
            "Civil & Hydromechanical": "SJCL",
            "Electrical & Transmission": "SNHL",
            "Environment & Social": "SJCL",
            "Finance & Accounts": "VLUCL",
            "Company Secretariat": "VLUCL",
            "Human Resources": "VLUCL",
            "Procurement & Stores": "SNHL",
        }
        post_codes = [code for _, code, _ in POSTS]
        blood = ["A+", "B+", "O+", "AB+", "A-", "O-"]

        for index, employee in enumerate(employees):
            department = employee.department.name if employee.department else "Plant Operations"
            employee.primary_company = companies[by_department.get(department, "SNHL")]
            # Seniority follows the designation's own rank where it has one, so
            # a Plant Manager does not come out an Assistant.
            rank = getattr(employee.designation, "rank", 0) or 0
            employee.corporate_post = posts[post_codes[min(max(rank, 1), len(post_codes)) - 1]]
            employee.blood_group = blood[index % len(blood)]
            surname = (employee.user.last_name or "staff").lower()
            initial = (employee.user.first_name or "x")[0].lower()
            employee.office_email = f"{initial}.{surname}@vlucl.com.np"
            employee.office_phone = f"071-5{40000 + index:05d}"
            employee.personal_email = f"{initial}{surname}{index}@gmail.com"
            employee.personal_phone = f"98{41000000 + index * 137:08d}"
            employee.permanent_address = f"{department.split()[0]} Tole, {employee.primary_company.district}"
            if index % 3 == 0:
                employee.temporary_address = "Baglung Tole, Pokhara-8, Kaski"
            employee.save()

        # A handful of secondments. The shared-services case the two fields
        # exist for: on one payroll, working across three sites.
        for employee in employees[:6]:
            others = [c for code, c in companies.items() if c != employee.primary_company]
            employee.secondary_companies.set(random.sample(others, k=min(2, len(others))))

        # The roles, on the seniors only — a role is a headship, not something
        # everybody holds.
        seniors = [e for e in employees if (getattr(e.designation, "rank", 0) or 9) <= 3][:9]
        for employee, code in zip(seniors, [c for _, c, _ in ROLES]):
            employee.corporate_role = roles[code]
            employee.save(update_fields=["corporate_role"])

        self.stdout.write(f"  · {len(employees)} people attached to companies")
        return {e.employee_code: e for e in employees}

    # ── Conduct ──────────────────────────────────────────────────────────

    def _conduct(self, people):
        staff = list(people.values())
        if len(staff) < 8:
            return
        today = date.today()

        awards = [
            (staff[2], "Zero lost-time injuries, FY 2081/82", Award.Kind.SAFETY,
             "Board of Directors", "For an unbroken year at the powerhouse without a reportable incident."),
            (staff[5], "Ten years of service", Award.Kind.LONG_SERVICE, "Chief Executive Officer", ""),
            (staff[7], "Tailrace desilting redesign", Award.Kind.INNOVATION, "Technical Committee",
             "For a modification that cut annual desilting downtime by eleven days."),
            (staff[11 % len(staff)], "Monsoon response, Ashad 2082", Award.Kind.TEAMWORK,
             "Plant Operations", "For restoring generation within nineteen hours of the intake blockage."),
        ]
        for employee, title, kind, by, citation in awards:
            Award.objects.get_or_create(
                employee=employee, title=title,
                defaults={
                    "kind": kind,
                    "awarded_on": today - timedelta(days=random.randint(40, 400)),
                    "awarded_by": by,
                    "citation": citation,
                },
            )

        actions = [
            (staff[9 % len(staff)], "Unauthorised absence, 12–14 Poush",
             DisciplinaryAction.Severity.WRITTEN, DisciplinaryAction.Status.UPHELD, 300),
            (staff[13 % len(staff)], "Failure to log the switchyard isolation",
             DisciplinaryAction.Severity.FINAL, DisciplinaryAction.Status.UNDER_REVIEW, 365),
            (staff[15 % len(staff)], "Late arrival, repeated",
             DisciplinaryAction.Severity.VERBAL, DisciplinaryAction.Status.CLOSED, 180),
        ]
        for employee, subject, severity, status, expiry_days in actions:
            issued = today - timedelta(days=random.randint(30, 200))
            DisciplinaryAction.objects.get_or_create(
                employee=employee, subject=subject,
                defaults={
                    "severity": severity,
                    "status": status,
                    "incident_date": issued - timedelta(days=6),
                    "issued_on": issued,
                    "description": "Recorded by the department head and referred to HR.",
                    "employee_response": "Explanation submitted in writing.",
                    "expires_on": issued + timedelta(days=expiry_days),
                },
            )

        # One live suspension, so the lock-out, the roster chip and the email
        # are all visible without anybody having to create one.
        target = staff[17 % len(staff)]
        if not target.suspensions.exists():
            try:
                suspend(
                    target,
                    starts_on=today - timedelta(days=3),
                    ends_on=today + timedelta(days=11),
                    reason="Pending inquiry into the switchyard isolation incident of 2 Bhadra.",
                )
            except Exception:  # noqa: BLE001 — a demo seed never fails the run
                pass
        self.stdout.write("  · awards, disciplinary records and one live suspension")

    def _experience(self, people):
        """Previous employment for a few, so the two sections both have rows."""
        staff = list(people.values())[:10]
        elsewhere = [
            ("Site Engineer", "Chilime Hydropower Company", 2016, 2020),
            ("Assistant Engineer", "Butwal Power Company", 2014, 2018),
            ("Graduate Trainee", "Nepal Electricity Authority", 2013, 2015),
        ]
        for index, employee in enumerate(staff):
            title, company, start, end = elsewhere[index % len(elsewhere)]
            EmployeeExperience.objects.get_or_create(
                employee=employee, title=title, company=company,
                defaults={
                    "kind": EmployeeExperience.Kind.PREVIOUS,
                    "start_year": start, "end_year": end,
                    "is_verified": index % 2 == 0,
                },
            )
            if employee.designation:
                EmployeeExperience.objects.get_or_create(
                    employee=employee, title=employee.designation.title, company="",
                    defaults={
                        "kind": EmployeeExperience.Kind.INTERNAL,
                        "start_year": employee.date_joined.year,
                        "is_verified": True,
                    },
                )

    # ── Money ────────────────────────────────────────────────────────────

    def _budgets(self):
        from employees.models import Department

        ops = Department.objects.filter(code="OPS").first()
        specs = [
            ("Company-wide", "", None, Decimal("2500000"), Decimal("50000"), "warn"),
            ("Travel", "travel", None, Decimal("800000"), Decimal("25000"), "warn"),
            ("Plant Operations travel", "travel", ops, Decimal("300000"), Decimal("20000"), "block"),
            ("Meals", "meals", None, Decimal("120000"), Decimal("2500"), "block"),
        ]
        for name, category, department, amount, cap, enforcement in specs:
            ExpenseBudget.objects.get_or_create(
                category=category, department=department, employee=None,
                period=ExpenseBudget.Period.FISCAL_YEAR,
                defaults={
                    "name": name,
                    "amount": amount,
                    "per_claim_cap": cap,
                    "enforcement": enforcement,
                    "warn_at_percent": 80,
                },
            )
        self.stdout.write("  · expense budgets and caps")

    # ── Events ───────────────────────────────────────────────────────────

    def _events(self, companies, people):
        staff = list(people.values())
        if not staff:
            return
        now = timezone.now()
        specs = [
            ("Q3 Board Meeting", Event.Kind.BOARD, "VLUCL", -45,
             "FY83 capital plan; Sanjen tailrace variation", "Corporate office, Butwal",
             Event.Status.COMPLETED),
            ("Public hearing, Uttargaya-4", Event.Kind.PUBLIC, "SJCL", -18,
             "Access road alignment and compensation", "Ward office, Uttargaya",
             Event.Status.COMPLETED),
            ("Annual fire and evacuation drill", Event.Kind.DRILL, "SNHL", -7,
             "Powerhouse and switchyard evacuation", "Powerhouse, Seti Nadi",
             Event.Status.COMPLETED),
            ("NEA metering audit", Event.Kind.INSPECTION, "SNHL", 9,
             "Energy meter calibration and monthly billing reconciliation", "Switchyard",
             Event.Status.CONFIRMED),
            ("Sanjen commissioning readiness review", Event.Kind.MEETING, "SJCL", 21,
             "Unit 1 wet commissioning readiness", "Site office, Sanjen",
             Event.Status.PLANNED),
            ("15th Annual General Meeting", Event.Kind.AGM, "VLUCL", 44,
             "FY82 accounts, dividend and director election", "Hotel Siddhartha, Butwal",
             Event.Status.PLANNED),
        ]
        outsiders = [
            ("Kumar Tamang", "Ward Chair, Uttargaya-4", EventStakeholder.Role.CHAIR),
            ("Sarita Gurung", "Nepal Electricity Authority", EventStakeholder.Role.OBSERVER),
            ("R. K. Shrestha", "China Gezhouba Group, site manager", EventStakeholder.Role.GUEST),
        ]
        for title, kind, company_code, offset, subject, location, status in specs:
            event, made = Event.objects.get_or_create(
                title=title,
                defaults={
                    "kind": kind,
                    "status": status,
                    "company": companies.get(company_code),
                    "subject_matter": subject,
                    "location": location,
                    "starts_at": now + timedelta(days=offset, hours=3),
                    "ends_at": now + timedelta(days=offset, hours=6),
                    "organiser": random.choice(staff),
                    "outcome": "Minutes circulated." if offset < 0 else "",
                },
            )
            if not made:
                continue
            for employee in random.sample(staff, k=min(4, len(staff))):
                EventStakeholder.objects.create(
                    event=event, employee=employee,
                    role=EventStakeholder.Role.ATTENDEE,
                    attended=True if offset < 0 else None,
                )
            # The reason a stakeholder is a name and not a foreign key.
            if kind in (Event.Kind.PUBLIC, Event.Kind.INSPECTION, Event.Kind.AGM):
                for name, organisation, role in outsiders:
                    EventStakeholder.objects.create(
                        event=event, name=name, organisation=organisation, role=role,
                        attended=True if offset < 0 else None,
                    )
        self.stdout.write("  · events, past and upcoming")

    # ── Field visits ─────────────────────────────────────────────────────

    def _field_visits(self, companies, people):
        staff = list(people.values())
        if len(staff) < 6:
            return
        today = date.today()
        specs = [
            # One covering today, so the attendance seam is visible: this
            # person has no clock-in and must not be marked absent.
            (staff[3], "SJCL", FieldVisit.Purpose.SUPERVISION,
             "Sanjen headworks — weekly supervision", "Sanjen Khola headworks, Rasuwa",
             -1, 3, FieldVisit.Status.APPROVED),
            (staff[6], "SNHL", FieldVisit.Purpose.INSPECTION,
             "Penstock inspection after monsoon", "Penstock alignment, Machhapuchchhre-4",
             -20, -17, FieldVisit.Status.COMPLETED),
            (staff[8], "MCTL", FieldVisit.Purpose.SURVEY,
             "Transmission corridor walkover", "Marsyangdi corridor, Lamjung",
             -40, -36, FieldVisit.Status.COMPLETED),
            (staff[10 % len(staff)], "SJCL", FieldVisit.Purpose.COMMUNITY,
             "Compensation follow-up with the ward", "Uttargaya-4 ward office",
             6, 7, FieldVisit.Status.REQUESTED),
            (staff[12 % len(staff)], "SNHL", FieldVisit.Purpose.EMERGENCY,
             "Intake blockage after the Ashad flood", "Intake, Seti Nadi",
             -60, -58, FieldVisit.Status.COMPLETED),
        ]
        for employee, company_code, purpose, title, destination, start_off, end_off, status in specs:
            visit, made = FieldVisit.objects.get_or_create(
                employee=employee, title=title,
                defaults={
                    "company": companies.get(company_code),
                    "purpose": purpose,
                    "destination": destination,
                    "district": companies.get(company_code).district if companies.get(company_code) else "",
                    "starts_on": today + timedelta(days=start_off),
                    "ends_on": today + timedelta(days=end_off),
                    "description": "As per the approved site programme.",
                    "transport": "Company pickup",
                    "estimated_cost": Decimal(random.choice(["12000", "18500", "24000"])),
                    "approver": staff[0],
                },
            )
            if not made:
                continue
            FieldVisitParticipant.objects.create(
                visit=visit, employee=random.choice(staff), role="Accompanying engineer"
            )
            FieldVisitParticipant.objects.create(
                visit=visit, name="Bishnu Adhikari",
                organisation="Contractor — site foreman", role="Guide",
            )
            # Moved through the real service so the notification and the
            # attendance seam behave exactly as they will in use.
            if status != FieldVisit.Status.DRAFT:
                request_visit(visit)
            if status in (FieldVisit.Status.APPROVED, FieldVisit.Status.COMPLETED):
                decide_visit(visit, approve=True, note="Travel order issued.")
            if status == FieldVisit.Status.COMPLETED:
                visit.report = (
                    "Alignment inspected over four chainages. Two anchor blocks show "
                    "surface cracking; photographs attached. Recommend a follow-up "
                    "survey before the next monsoon."
                )
                visit.status = FieldVisit.Status.COMPLETED
                visit.completed_at = timezone.now()
                visit.save()
        self.stdout.write("  · field visits, one covering today")

    # ── Assets and the desk ──────────────────────────────────────────────

    def _assets(self, people):
        """A history for a few assets, so the log is not an empty dialog."""
        staff = list(people.values())
        today = date.today()
        for asset in Asset.objects.all()[:8]:
            if asset.events.exists():
                continue
            record_asset_event(
                asset, AssetEvent.Kind.ACQUIRED,
                note="Received from Procurement & Stores.",
                on=today - timedelta(days=random.randint(400, 900)),
            )
            if asset.assigned_to:
                record_asset_event(
                    asset, AssetEvent.Kind.ASSIGNED, custodian=asset.assigned_to,
                    to_value=asset.status, note="Issued at induction.",
                    on=today - timedelta(days=random.randint(60, 380)),
                )
            if random.random() < 0.5:
                record_asset_event(
                    asset, AssetEvent.Kind.MAINTENANCE, custodian=asset.assigned_to,
                    note="Battery replacement.", on=today - timedelta(days=random.randint(20, 55)),
                )
                record_asset_event(
                    asset, AssetEvent.Kind.REPAIRED, custodian=asset.assigned_to,
                    note="Back from the service centre.",
                    on=today - timedelta(days=random.randint(5, 19)),
                )

    def _helpdesk(self, people):
        """Route the open tickets to a desk, so the field is not empty."""
        from employees.models import Department

        desks = {d.code: d for d in Department.objects.all()}
        mapping = {"it": "HR", "hr": "HR", "facilities": "PRC", "payroll": "FIN"}
        for ticket in Ticket.objects.filter(target_department__isnull=True)[:40]:
            code = mapping.get(ticket.category)
            if code and code in desks:
                ticket.target_department = desks[code]
                ticket.save(update_fields=["target_department"])

    # ── Memoranda ────────────────────────────────────────────────────────

    def _memo_actions(self):
        made = {}
        for name, code, effect, order, for_approver, description in MEMO_ACTIONS:
            made[code], _ = MemorandumAction.objects.update_or_create(
                code=code,
                defaults={
                    "name": name, "effect": effect, "order": order,
                    "for_approver": for_approver, "description": description,
                },
            )
        self.stdout.write(f"  · {len(made)} memorandum actions")
        return made

    def _memoranda(self, companies, people, actions):
        """One memorandum in each state the chain can be in.

        A workflow with no in-flight examples is one nobody can see working —
        and the states that matter most are the awkward ones: sent back and
        climbing again, and sitting with an approver.
        """
        staff = list(people.values())
        if len(staff) < 8:
            return

        # **The HR admin is in the chain on purpose.**
        #
        # The cast used to be whichever employees came out of the dictionary
        # first, and none of them was the account anybody demonstrates the
        # system with. So signing in as the HR admin — the obvious persona for
        # a walkthrough, and the one every screenshot in the manual is taken
        # as — showed an empty desk: nothing waiting, nothing raised, nothing
        # handled. Seven memoranda existed and the reviewer could see none of
        # them, which reads as a broken module rather than as somebody else's
        # paperwork.
        #
        # Put them second in the chain rather than first: that leaves one
        # memorandum genuinely waiting on them, one already handled and behind
        # them, and the rest visible without being theirs — which is the shape
        # of a real desk.
        admin = next(
            (p for p in staff if getattr(p.user, "role", None) == "hr_admin"), None
        )

        initiator = staff[4]
        chain = [staff[2], admin or staff[0], staff[1]]
        chain = list(dict.fromkeys(c for c in chain if c is not None and c != initiator))
        approver = next(p for p in staff if p not in chain and p != initiator)

        recommend = actions["REC"]
        verified = actions["VER"]
        returned = actions["RET"]
        today = date.today()

        specs = [
            ("draft", "Procurement of two spare governor actuators", "SNHL"),
            ("waiting_first", "Revision of the Sanjen access road alignment", "SJCL"),
            ("midway", "Engagement of a consultant for the corridor survey", "MCTL"),
            ("with_approver", "Annual maintenance shutdown, Mangsir 2082", "SNHL"),
            ("returned", "Staff quarters allowance revision", "VLUCL"),
            ("approved", "Purchase of a replacement site vehicle", "SJCL"),
            ("rejected", "Additional office space at Butwal", "VLUCL"),
        ]

        body = (
            "<p>It is proposed that the following be approved.</p>"
            "<p><strong>Background.</strong> The matter arises from the site "
            "programme circulated last month and the observations recorded during "
            "the most recent inspection.</p>"
            "<p><strong>Proposal.</strong></p>"
            "<ul><li>Approve the scope described above.</li>"
            "<li>Authorise the estimated expenditure.</li>"
            "<li>Direct that the work be completed before the monsoon.</li></ul>"
            "<p>Submitted for kind consideration and approval.</p>"
        )

        for state, subject, company_code in specs:
            if Memorandum.objects.filter(subject=subject).exists():
                continue
            memo = Memorandum.objects.create(
                company=companies[company_code],
                memo_date=today,
                subject=subject,
                content=body,
                initiator=initiator,
                approver=approver,
            )
            set_chain(memo, [p.pk for p in chain])
            if state == "draft":
                continue

            submit(memo)
            memo.refresh_from_db()

            if state == "waiting_first":
                continue

            proceed(memo, chain[0], action=recommend,
                    comment="Alignment checked against the approved drawings. Recommended.")
            memo.refresh_from_db()
            if state == "midway":
                continue

            if state == "returned":
                send_back(
                    memo, chain[1], to=initiator, action=returned,
                    comment="The cost estimate in paragraph three does not match the annexure. "
                            "Please correct and resubmit.",
                )
                memo.refresh_from_db()
                resubmit(memo, initiator, comment="Estimate corrected against the annexure.")
                continue

            proceed(memo, chain[1], action=verified, comment="Figures verified against the ledger.")
            memo.refresh_from_db()
            proceed(memo, chain[2], action=recommend, comment="Supported.")
            memo.refresh_from_db()
            if state == "with_approver":
                continue

            decide_memo(
                memo, approver,
                approve=(state == "approved"),
                comment=(
                    "Approved. Proceed as proposed."
                    if state == "approved"
                    else "Not this fiscal year. Resubmit with the FY83 budget."
                ),
            )
        self.stdout.write("  · memoranda in every state the chain can be in")
