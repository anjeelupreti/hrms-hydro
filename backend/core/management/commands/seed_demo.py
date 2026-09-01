"""Seed a company with rich, realistic (Nepal-flavoured) demo data.

Idempotent-ish: employees are keyed by username so re-running won't
duplicate people, and most look-ups use get_or_create. Intended for demo
/ review environments only — never wire this into production startup.

    python manage.py seed_demo
"""

import random
from datetime import date, datetime, timedelta
from datetime import time as dt_time
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from assets.models import Asset, AssetAssignment
from attendance.models import AttendanceLog
from checklists.models import Checklist, ChecklistTask, ChecklistTemplate, ChecklistTemplateItem
from core.calendars import company_calendar
from crm.models import Client, Contact, Deal, Invoice, InvoiceLineItem
from documents.models import RepositoryDocument
from employees.models import (
    Department,
    Designation,
    Employee,
    EmployeeExperience,
    EmployeeLog,
)
from expenses.models import ExpenseClaim
from goals.models import KeyResult, Objective
from helpdesk.models import Ticket, TicketComment
from leave.models import LeaveRequest, LeaveType
from notifications.models import Holiday, Notification
from organization.models import CompanyProfile, Review, ReviewCycle
from projects.models import Project, ProjectTask
from recruitment.models import Candidate, JobPosting
from surveys.models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse
from timesheets.models import TimeEntry
from training.models import Enrollment, TrainingProgram, TrainingSession
from wfh.models import WFHRequest

User = get_user_model()

CITIES = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Biratnagar", "Chitwan", "Butwal"]

# ---------------------------------------------------------------------------
# The demo company: a Nepali hydropower investment company.
#
# **Why this one rather than another generic software firm.** A demo is only
# useful if the *shape* of its data exercises the product, and a hydropower
# operator does things a software company never does: it runs a powerhouse
# round the clock, so night shifts and shift allowances are real rather than a
# checkbox nobody ticks; it sends people to a site eight hours' drive away, so
# field visits, travel advances and per-diems have to work; it answers to a
# regulator and a stock exchange, so board meetings and statutory filings are
# calendar items with consequences.
#
# The company and its project are modelled on **Vision Lumbini Urja Company
# Limited** and the facts here are the published ones: incorporated 2018,
# registered at Butwal-8 Rupandehi, operator of the 25 MW run-of-river Seti
# Nadi Hydroelectric Project in Machhapuchchhre Rural Municipality of Kaski,
# with a catchment of about 254 km² and a design discharge near 18 m³/s, in
# commercial operation since late 2024 and listed on NEPSE.
#
# 🔒 **Every person below is invented.** Real project facts make the demo feel
# like a real company; real people's names attached to invented salaries,
# appraisals and disciplinary records would not be a demo, it would be a
# fabrication about identifiable individuals. The staff, their pay and their
# records are fiction on a factual stage.
# ---------------------------------------------------------------------------

COMPANY_NAME = "Vision Lumbini Urja Company Limited"

COMPANY_ADDRESS = "Butwal-8, Rupandehi, Lumbini Province"

DEPARTMENTS = [
    ("Plant Operations", "OPS"),
    ("Civil & Hydromechanical", "CIV"),
    ("Electrical & Transmission", "ELE"),
    ("Environment & Social", "ESG"),
    ("Finance & Accounts", "FIN"),
    ("Company Secretariat", "SEC"),
    ("Human Resources", "HR"),
    ("Procurement & Stores", "PRC"),
]

DESIGNATIONS = {
    "Plant Operations": [
        "Plant Manager",
        "Shift Engineer",
        "Control Room Operator",
        "Turbine Technician",
    ],
    "Civil & Hydromechanical": [
        "Civil Engineer",
        "Site Supervisor",
        "Survey Technician",
    ],
    "Electrical & Transmission": [
        "Electrical Engineer",
        "Substation Technician",
        "Line Inspector",
    ],
    "Environment & Social": [
        "Environment Officer",
        "CSR Officer",
    ],
    "Finance & Accounts": [
        "Finance Manager",
        "Accounts Officer",
        "Internal Auditor",
    ],
    "Company Secretariat": [
        "Company Secretary",
        "Investor Relations Officer",
    ],
    "Human Resources": [
        "HR Manager",
        "HR Officer",
    ],
    "Procurement & Stores": [
        "Procurement Officer",
        "Store Keeper",
    ],
}

SKILLS_POOL = [
    "Hydrology", "AutoCAD", "SCADA", "Turbine Maintenance", "Switchyard Ops",
    "HV Safety", "Survey & Levelling", "Environmental Monitoring",
    "Community Liaison", "NEA Billing", "NFRS Reporting", "Procurement",
    "Contract Management", "First Aid", "Rope Access", "Nepali & English",
]

# (first, last, department, gender)
#
# A roster shaped like an operating hydropower company rather than an office:
# the plant carries the most people because it is staffed around the clock, and
# the head-office functions are small because they are.

_CORE_PEOPLE = [
    # Plant Operations — the powerhouse at Seti Nadi, staffed in three shifts.
    ("Rajendra", "Poudel", "Plant Operations", "male"),
    ("Bikash", "Shrestha", "Plant Operations", "male"),
    ("Sarita", "Gurung", "Plant Operations", "female"),
    ("Dipak", "Bhandari", "Plant Operations", "male"),
    ("Manoj", "Tamang", "Plant Operations", "male"),
    ("Kabita", "Thapa", "Plant Operations", "female"),
    ("Suman", "Lamichhane", "Plant Operations", "male"),
    ("Hari", "Pariyar", "Plant Operations", "male"),
    # Civil — headworks, desanding basin, penstock, access roads.
    ("Nirajan", "Acharya", "Civil & Hydromechanical", "male"),
    ("Puja", "Subedi", "Civil & Hydromechanical", "female"),
    ("Tek", "Bahadur Rana", "Civil & Hydromechanical", "male"),
    # Electrical — switchyard and the 132 kV line to the grid.
    ("Ramesh", "Khadka", "Electrical & Transmission", "male"),
    ("Anjana", "Baral", "Electrical & Transmission", "female"),
    ("Sanjay", "Yadav", "Electrical & Transmission", "male"),
    # Environment & social — the licence to operate, in practice.
    ("Sunita", "Bhattarai", "Environment & Social", "female"),
    ("Prakash", "Chaudhary", "Environment & Social", "male"),
    # Head office.
    ("Bimala", "Kandel", "Finance & Accounts", "female"),
    ("Nabin", "Regmi", "Finance & Accounts", "male"),
    ("Sabina", "Joshi", "Finance & Accounts", "female"),
    ("Deepak", "Sapkota", "Company Secretariat", "male"),
    ("Rekha", "Aryal", "Company Secretariat", "female"),
    ("Sushma", "Ghimire", "Human Resources", "female"),
    ("Arjun", "Panta", "Human Resources", "male"),
    ("Kiran", "Malla", "Procurement & Stores", "male"),
    ("Laxmi", "Bista", "Procurement & Stores", "female"),
]

#: Who the company actually deals with.
#:
#: For a generation company the "client" list is not customers in the retail
#: sense — there is one offtaker, and the rest are lenders, regulators and
#: contractors. Modelled that way rather than as a sales pipeline, because a
#: hydropower company with six prospects to close is not a hydropower company.

_GIVEN_MALE = [
    "Aayush", "Abhishek", "Amrit", "Anil", "Ashok", "Barsha", "Bhuwan", "Bijay",
    "Binod", "Dipesh", "Gagan", "Hari", "Ishan", "Kiran", "Krishna", "Kushal",
    "Madan", "Milan", "Nabin", "Naresh", "Nirajan", "Pemba", "Prabin", "Pradip",
    "Rabin", "Rajesh", "Rohit", "Sagar", "Samir", "Sandesh", "Santosh", "Saroj",
    "Shyam", "Subash", "Sujan", "Sunil", "Suraj", "Tenzing", "Ujjwal", "Yogesh",
]
_GIVEN_FEMALE = [
    "Alina", "Anjali", "Anushka", "Aarati", "Bandana", "Bhawana", "Deepa",
    "Dolma", "Gita", "Ishwori", "Jyoti", "Kabita", "Laxmi", "Manisha", "Mina",
    "Muna", "Nisha", "Parbati", "Pooja", "Pramila", "Rachana", "Rekha", "Renu",
    "Sabina", "Samjhana", "Sangita", "Sarita", "Shanti", "Shobha", "Sirjana",
    "Smriti", "Sunita", "Susmita", "Tara", "Urmila", "Yamuna",
]
_SURNAMES = [
    "Acharya", "Adhikari", "Bajracharya", "Baral", "Basnet", "Bhandari",
    "Bhattarai", "Chettri", "Dahal", "Dhakal", "Ghimire", "Gurung", "Joshi",
    "Karki", "Khadka", "Koirala", "Lama", "Limbu", "Magar", "Maharjan",
    "Nepal", "Neupane", "Oli", "Pandey", "Paudel", "Poudel", "Pun", "Rai",
    "Regmi", "Sapkota", "Shakya", "Sherpa", "Shrestha", "Subedi", "Tamang",
    "Thapa", "Tuladhar",
]

#: Headcount by department, shaped like a services company of this size rather
#: than split evenly. An even split is the giveaway that data is fabricated —
#: real companies are engineering-heavy and HR-light, and every per-department
#: chart is misleading if the shape is wrong.
_DEPARTMENT_SHAPE = [
    # A powerhouse carries the headcount; head office is small because it is.
    ("Plant Operations", 38),
    ("Civil & Hydromechanical", 16),
    ("Electrical & Transmission", 14),
    ("Procurement & Stores", 10),
    ("Environment & Social", 8),
    ("Finance & Accounts", 7),
    ("Human Resources", 4),
    ("Company Secretariat", 3),
]

TARGET_HEADCOUNT = 100


def _build_people():
    """The full roster: the hand-written core, then generated colleagues.

    Deterministic — seeded from a fixed value — so re-running the seed produces
    the same company. A demo whose staff list reshuffles on every run makes
    "is this bug reproducible?" unanswerable.
    """
    import random as _random

    rng = _random.Random(20830413)  # fixed: reproducibility beats novelty here
    people = list(_CORE_PEOPLE)
    taken = {(first, last) for first, last, _, _ in people}

    # Shortfall per department, after the hand-written people already in each.
    from collections import Counter

    have = Counter(dept for _, _, dept, _ in people)
    wanted = []
    for dept, target in _DEPARTMENT_SHAPE:
        wanted.extend([dept] * max(0, target - have.get(dept, 0)))
    rng.shuffle(wanted)

    for dept in wanted:
        if len(people) >= TARGET_HEADCOUNT:
            break
        for _ in range(60):  # bounded: give up rather than loop forever
            gender = rng.choice(["male", "female"])
            first = rng.choice(_GIVEN_MALE if gender == "male" else _GIVEN_FEMALE)
            last = rng.choice(_SURNAMES)
            if (first, last) not in taken:
                taken.add((first, last))
                people.append((first, last, dept, gender))
                break

    return people


#: Banks the payroll exporters have real column layouts for. Anything else
#: would group into a batch that can only be downloaded as the generic CSV,
#: which is a worse demo than showing the formats working.
DEMO_BANKS = [
    "Nabil Bank",
    "NIC Asia Bank",
    "Global IME Bank",
    "Nepal Bank Limited",
]


def _bank_details(seq: int):
    """Bank fields for a seeded employee — or none, for a few of them.

    Every seventh and every eleventh person is left unbanked on purpose, so the
    disbursement screen always has exclusions to show. A demo in which everybody
    can be paid never renders the warning that somebody cannot, which is the
    part of that screen worth seeing.
    """
    if seq % 7 == 0 or seq % 11 == 0:
        return {}
    bank = DEMO_BANKS[seq % len(DEMO_BANKS)]
    return {
        "bank_name": bank,
        "bank_branch": random.choice(CITIES),
        "bank_account_number": f"{seq:04d}{random.randint(10**7, 10**8 - 1)}",
        "bank_account_type": Employee.BankAccountType.SALARY,
    }


PEOPLE = _build_people()

HYDRO_PROJECTS = [
    (
        "Seti Nadi Hydroelectric Project — 25 MW",
        "Run-of-river, Machhapuchchhre RM, Kaski. Catchment ~254 km², design "
        "discharge ~18 m³/s. In commercial operation.",
        "active",
    ),
    (
        "Upper Seti-1 — development",
        "Equity participation with Shrestha Energy Solutions. Feasibility, "
        "licensing and financial close.",
        "active",
    ),
    (
        "132 kV line — monsoon strengthening",
        "Tower foundation protection and right-of-way clearing before the "
        "next monsoon.",
        "active",
    ),
    (
        "Annual overhaul — Unit 1 & 2",
        "Turbine and generator overhaul during the low-flow window.",
        "on_hold",
    ),
    (
        "Sardikhola CSR programme",
        "School block, health post supplies and the irrigation intake "
        "agreement with the affected wards.",
        "active",
    ),
    (
        "SCADA and protection upgrade",
        "Replacing the original control system and coordinating protection "
        "settings with the grid operator.",
        "planning",
    ),
]

#: Announcements a generation company actually posts.
#:
#: Real notices rather than "Welcome to the team!" — an announcement board is
#: only convincing if the notices could have come from nowhere else.
ANNOUNCEMENTS = [
    (
        "Monsoon readiness — headworks and access road",
        "The met office expects heavy inflow from the second week. Civil and "
        "Plant Operations to complete the pre-monsoon checklist on the "
        "desanding basin gates, the spillway and the Sardikhola access road by "
        "Friday. Report blockers to the Plant Manager the same day.",
        "Civil & Hydromechanical",
        True,
    ),
    (
        "Unit 2 overhaul window confirmed — low-flow period",
        "The annual overhaul of Unit 2 is confirmed for the low-flow window. "
        "Shift rosters change for four weeks; Plant Operations will publish the "
        "revised rota. Leave during the window needs the Plant Manager's "
        "approval rather than the usual line approval.",
        "Plant Operations",
        True,
    ),
    (
        "SSF contribution now itemised on your payslip",
        "From this month your payslip shows the employer and employee shares "
        "separately. If your SSF number is missing from your profile, add it "
        "under My profile. Finance cannot file a return against a blank number.",
        None,
        False,
    ),
    (
        "AGM date and closure of the share register",
        "The Annual General Meeting will be held at the registered office in "
        "Butwal. The share register closes seven days prior. Company "
        "Secretariat will circulate the notice, the annual report and the proxy "
        "form to shareholders.",
        "Company Secretariat",
        False,
    ),
    (
        "Sardikhola community grievance — outcome",
        "The grievance raised over irrigation intake timing has been settled. "
        "Release timings are revised during the paddy season and the agreement "
        "is filed with the ward office. Thanks to the Environment & Social team "
        "for two months of patient work.",
        "Environment & Social",
        False,
    ),
    (
        "HV safety refresher — mandatory for switchyard staff",
        "The annual high-voltage safety refresher runs over two half-days. "
        "Attendance is mandatory for anyone with switchyard access; access "
        "cards will be suspended for those who have not completed it.",
        "Electrical & Transmission",
        False,
    ),
    (
        "Dashain and Tihar — plant staffing",
        "The powerhouse runs through the festival. Shift allowances apply at the "
        "festival rate and the roster is published two weeks ahead so people can "
        "plan travel. Head office closes on the gazetted days.",
        None,
        True,
    ),
    (
        "Revised ceilings for field visit claims",
        "Per-diem and accommodation ceilings for site visits have changed. "
        "Claims above the ceiling need a note explaining why. The updated "
        "schedule is filed under Documents.",
        None,
        False,
    ),
]

#: Client-desk tickets — what an offtaker, a lender and a regulator actually
#: raise with a generation company.
#:
#: Deliberately none of them is "my printer is broken": that is the internal
#: helpdesk's queue, with a different audience and different privacy rules, and
#: seeding the two alike would make the split between them look arbitrary.
#:
#: (client index, subject, description, priority, channel, state)
CLIENT_TICKETS = [
    (
        0,
        "Metering discrepancy — last month's export reading",
        "Our meter reading at the Lekhnath interconnection differs from your "
        "declared export by roughly 0.4%. Requesting a joint reading before the "
        "invoice is settled.",
        "high",
        "email",
        "answered",
    ),
    (
        0,
        "Scheduled outage notice — 132 kV feeder",
        "Planned maintenance on the feeder will require your plant to back down "
        "for six hours. Confirm the window suits your overhaul schedule.",
        "normal",
        "email",
        "resolved",
    ),
    (
        4,
        "Quarterly generation return — clarification sought",
        "The submitted return does not reconcile with the previous quarter's "
        "closing figures. Provide a note explaining the variance within 15 days.",
        "urgent",
        "portal",
        "breaching",
    ),
    (
        2,
        "Debt service coverage certificate overdue",
        "The certificate for the period is overdue. Please have it signed by the "
        "auditor and uploaded to the lender portal.",
        "high",
        "portal",
        "open",
    ),
    (
        1,
        "Board observer seat — nomination",
        "We wish to nominate an observer to the board under the shareholders' "
        "agreement. Confirm the process and the next meeting date.",
        "normal",
        "phone",
        "answered",
    ),
    (
        5,
        "Upper Seti-1 — cost sharing for the access track",
        "Our share of the access track cost is disputed. The original split "
        "assumed a shorter alignment than the one built.",
        "high",
        "email",
        "open",
    ),
    (
        3,
        "Dividend payment instruction",
        "Please update the bank details we hold for dividend credit. Enclosing "
        "the board resolution.",
        "low",
        "email",
        "resolved",
    ),
    (
        0,
        "Settlement statement — deduction not explained",
        "A deduction appears on the statement without a supporting note. "
        "Requesting a breakdown before we release payment.",
        "urgent",
        "portal",
        "open",
    ),
]

#: Loans, in every state the model supports, with reasons a plant employee
#: would actually give. Every state occupied on purpose: a loans screen seeded
#: only with active ones cannot show that approving or refusing works.
LOANS = [
    ("office", 250000, 10000, "active", "Advance against the Kaski site posting — family relocation."),
    ("personal", 400000, 15000, "active", "Daughter's college admission."),
    ("personal", 150000, 12500, "closed", "Motorcycle purchase — repaid in full."),
    ("office", 600000, 20000, "requested", "House construction at Butwal, roof stage."),
    ("personal", 80000, 8000, "requested", "Medical treatment for my father."),
    ("office", 1200000, 30000, "rejected", "Land purchase."),
    ("personal", 200000, 10000, "approved", "Sister's wedding."),
]

#: Profile changes people actually ask for, in each state the flow supports.
#:
#: Every one of these is a field that moves money or establishes legal
#: identity — which is exactly why they are requested rather than written, and
#: why a demo of the approval queue needs them rather than a name change.
#:
#: (field, new value, reason, status)
CHANGE_REQUESTS = [
    ("bank_account_number", "01234567890123", "Switched to a branch nearer the plant.", "pending"),
    ("phone", "+977-9846012345", "New number.", "pending"),
    ("pan_number", "301234567", "PAN issued after I joined.", "approved"),
    ("citizenship_number", "27-01-70-01234", "Correcting a typo in the ward number.", "pending"),
    ("bank_name", "Shine Resunga Development Bank", "Salary account moved.", "approved"),
    ("marital_status", "married", "Married last Mangsir.", "approved"),
    ("ssf_number", "1010203040", "Enrolled in SSF this quarter.", "rejected"),
]

#: Shifts, because a powerhouse does not close.
#:
#: This is the reason the demo is a hydropower company: night work, a real
#: night allowance and a shift-specific unpaid break are ordinary here, and
#: they exercise parts of payroll and attendance that an office roster never
#: touches.

SHIFTS = [
    # (name, start, end, grace minutes, night?, allowance, unpaid break)
    ("Day (Powerhouse)", (6, 0), (14, 0), 10, False, 0, 30),
    ("Evening (Powerhouse)", (14, 0), (22, 0), 10, False, 0, 30),
    ("Night (Powerhouse)", (22, 0), (6, 0), 10, True, 800, 30),
    ("General (Head office)", (9, 0), (18, 0), 15, False, 0, 60),
]

#: Field visits — the thing a site eight hours from head office generates
#: constantly, and the thing a generic demo never has.

FIELD_VISITS = [
    ("Headworks inspection after monsoon flood", "Machhapuchchhre RM, Kaski", 3),
    ("Desanding basin flushing — witness", "Seti Nadi intake", 2),
    ("132 kV tower footing survey", "Kaski / Tanahun alignment", 4),
    ("Community grievance meeting — Sardikhola", "Sardikhola, Kaski", 2),
    ("Quarterly environment monitoring", "Project area", 3),
    ("Upper Seti-1 site reconnaissance", "Upper Seti catchment", 5),
    ("NEA metering point joint reading", "Lekhnath substation", 1),
    ("Store verification and scrap disposal", "Project store, Kaski", 2),
]

HOLIDAYS_2026 = [
    ("Prithvi Jayanti", date(2026, 1, 11)),
    ("Maghe Sankranti", date(2026, 1, 15)),
    ("Holi", date(2026, 3, 3)),
    ("Nepali New Year (2083)", date(2026, 4, 14)),
    ("Buddha Jayanti", date(2026, 5, 1)),
    ("Dashain (Ghatasthapana)", date(2026, 10, 11)),
    ("Vijaya Dashami", date(2026, 10, 20)),
    ("Tihar (Laxmi Puja)", date(2026, 11, 8)),
    ("Constitution Day", date(2026, 9, 19)),
]

CLIENTS = [
    ("Nepal Electricity Authority", "Power Purchase (PPA offtaker)"),
    ("Hydroelectricity Investment and Development Company", "Institutional investor"),
    ("Shine Resunga Development Bank", "Lender / promoter"),
    ("Sanima Reliance Life Insurance", "Institutional investor"),
    ("Department of Electricity Development", "Regulator"),
    ("Shrestha Energy Solutions", "Upper Seti-1 development partner"),
]

#: The projects a generation company runs: one plant in operation, one under
#: development, and the perennial capital works around them.

STAGE_WEIGHTS = {
    "applied": 0.35,
    "screening": 0.22,
    "interview": 0.18,
    "offer": 0.10,
    "hired": 0.08,
    "declined": 0.03,
    "rejected": 0.04,
}


class Command(BaseCommand):
    help = "Seed a company with rich Nepal-flavoured demo data."

    def handle(self, *args, **options):
        with transaction.atomic():
            self._seed()
        self.stdout.write(self.style.SUCCESS("Seeded demo data."))

    def _seed(self):
        random.seed(11)
        departments = {}
        for name, code in DEPARTMENTS:
            # Keyed on `code`, not `name`. Both columns are unique, and a
            # department can be renamed while keeping its code — "Operations"
            # and "Plant Operations" are both OPS. Looking up by name would
            # find nothing, try to create, and collide on the code, which fails
            # the whole command: it runs in one transaction.
            #
            # The code is the stable identity — it is what payroll exports,
            # employee codes and the org chart are keyed on — so match on that
            # and let the name follow. A department created through the app
            # (no code of ours) is still matched by name, so nothing gets
            # duplicated underneath a company that already organised itself.
            department = Department.objects.filter(code=code).first() or Department.objects.filter(name=name).first()
            if department is None:
                department = Department.objects.create(name=name, code=code)
            elif department.name != name:
                department.name = name
                department.save(update_fields=["name"])
            departments[name] = department

        designations = {}
        for dept_name, titles in DESIGNATIONS.items():
            for title in titles:
                designations[title], _ = Designation.objects.get_or_create(
                    title=title, defaults={"department": departments[dept_name]}
                )

        employees = self._seed_employees(departments, designations)
        self._assign_managers(employees, departments)
        hr = next((e for e in employees if e.user.role == User.Role.HR_ADMIN), employees[0] if employees else None)
        self._seed_attendance(employees)
        self._seed_leave(employees)
        self._seed_holidays()
        self._seed_training(employees)
        projects = self._seed_crm(employees)
        self._seed_recruitment(departments)
        self._seed_wfh(employees)
        # --- newer modules (Phase 14-17) ---
        self._safe("company profile", self._seed_company_profile)
        self._safe("shifts", self._seed_shifts, employees)
        self._safe("payroll", self._seed_payroll, employees)
        self._safe("expenses", self._seed_expenses, employees, hr)
        self._safe("documents", self._seed_documents)
        self._safe("checklists", self._seed_checklists, employees)
        self._safe("timesheets", self._seed_timesheets, employees, projects)
        # After timesheets, because a visit writes hours against the same
        # projects and wants them to exist.
        self._safe("field visits", self._seed_field_visits, employees, projects)
        self._safe("goals", self._seed_goals, employees)
        self._safe("assets", self._seed_assets, employees)
        self._safe("helpdesk", self._seed_helpdesk, employees, hr)
        self._safe("surveys", self._seed_surveys, employees)
        self._safe("reviews", self._seed_reviews, employees)
        self._safe("notifications", self._seed_notifications, hr)
        # The notice board, which was empty — and an empty board is genuinely
        # ambiguous in a way an empty payroll run is not.
        self._safe("announcements", self._seed_announcements, employees, departments)
        # The client desk. After CRM, because a ticket belongs to a client.
        self._safe("client tickets", self._seed_client_tickets, employees)
        # After payroll, so the loan repayment component already exists.
        self._safe("loans", self._seed_loans, employees)
        self._safe("change requests", self._seed_change_requests, employees, hr)

    def _safe(self, label, fn, *args):
        """Run one module's seed in a savepoint so a single failure doesn't
        abort the whole seed (the outer handle() is one transaction)."""
        from django.db import transaction as _txn
        try:
            with _txn.atomic():
                fn(*args)
        except Exception as exc:  # noqa: BLE001
            self.stderr.write(self.style.WARNING(f"  ! {label} skipped: {exc}"))

    def _seed_employees(self, departments, designations):
        created = []
        # continue employee codes after any existing ones
        existing_codes = list(Employee.objects.values_list("employee_code", flat=True))
        next_num = 1
        for c in existing_codes:
            if c.startswith("EMP-"):
                try:
                    next_num = max(next_num, int(c.split("-")[1]) + 1)
                except (IndexError, ValueError):
                    pass

        for first, last, dept_name, gender in PEOPLE:
            username = f"{first.lower()}.{last.lower()}"
            if User.objects.filter(username=username).exists():
                created.append(Employee.objects.get(user__username=username))
                continue
            role = User.Role.HR_ADMIN if dept_name == "Human Resources" else User.Role.EMPLOYEE
            user = User.objects.create(
                username=username,
                # `example.com` is reserved by IANA precisely so it can never
                # belong to anyone (RFC 2606). Seed data reaches places nobody
                # plans for — screenshots on the public site, support tickets,
                # exported spreadsheets — so a hundred fictional people must not
                # carry somebody's real domain.
                email=f"{username}@example.com",
                first_name=first,
                last_name=last,
                role=role,
                is_active=True,
            )
            user.set_password("TestPass123!")
            user.save()

            title = random.choice(DESIGNATIONS[dept_name])
            emp = Employee.objects.create(
                user=user,
                employee_code=f"EMP-{next_num:04d}",
                department=departments[dept_name],
                designation=designations[title],
                phone=f"+977-98{random.randint(10000000, 49999999)}",
                city=random.choice(CITIES),
                country="Nepal",
                gender=gender,
                date_of_birth=date(random.randint(1985, 2000), random.randint(1, 12), random.randint(1, 28)),
                date_joined=date.today() - timedelta(days=random.randint(120, 1600)),
                bio=f"{title} in the {dept_name} team, based in Nepal.",
                skills=random.sample(SKILLS_POOL, k=random.randint(3, 6)),
                # Bank details, without which `build_payment_batches` excludes
                # everybody and the second half of payroll — per-bank files,
                # sent versus acknowledged — cannot be demonstrated at all.
                #
                # Spread across the banks the exporters actually support, so
                # the demo builds several instructions and shows the grouping
                # rather than one lump. **Two people are deliberately left
                # without an account** (below) — a run where everybody is
                # payable never shows the exclusion warning, which is the part
                # of that screen worth seeing.
                **_bank_details(next_num),
                # Some turnover, so the directory's past-employees vault, the
                # offboarding checklists and the freeing of a seat all have
                # something to point at. A hundred people and no leaver in four
                # years is not a company.
                employment_status=random.choices(
                    [
                        Employee.EmploymentStatus.ACTIVE,
                        Employee.EmploymentStatus.ON_LEAVE,
                        Employee.EmploymentStatus.RESIGNED,
                        Employee.EmploymentStatus.TERMINATED,
                    ],
                    weights=[0.82, 0.10, 0.06, 0.02],
                )[0],
            )
            next_num += 1
            created.append(emp)

            # Somebody who has left cannot sign in. `apply_event` does this in
            # the product via `revoke_access`; the seed writes the status
            # directly, so it has to close the login itself or the demo would
            # contradict its own rule — a terminated employee with a working
            # account is exactly the state the lifecycle work exists to prevent.
            if emp.employment_status in (
                Employee.EmploymentStatus.RESIGNED,
                Employee.EmploymentStatus.TERMINATED,
            ):
                emp.user.is_active = False
                emp.user.save(update_fields=["is_active"])

            if random.random() < 0.5:
                EmployeeExperience.objects.create(
                    employee=emp,
                    title=f"Junior {title}",
                    company=random.choice(["Leapfrog", "Fusemachines", "Deerwalk", "Verisk Nepal"]),
                    start_year=random.randint(2015, 2019),
                    end_year=random.randint(2020, 2022),
                    description="Earlier role before joining.",
                )

            # Promotions, so the position timeline on a profile has more than
            # one span to draw.
            #
            # Written as `EmployeeLog` rows because that is where field-change
            # history lives (see the model's docstring); the timeline
            # reconstructs the spans between them. `created_at` is
            # `auto_now_add`, so the date has to be set with an `update()`
            # afterwards — assigning it on create is silently ignored, which
            # would put every promotion at today and collapse the timeline to
            # a single span again.
            tenure_days = (date.today() - emp.date_joined).days
            if tenure_days > 500 and random.random() < 0.35:
                junior_title = f"Associate {title}"
                promoted_on = emp.date_joined + timedelta(days=random.randint(365, tenure_days - 60))
                log = EmployeeLog.objects.create(
                    employee=emp,
                    field=EmployeeLog.Field.DESIGNATION,
                    from_value=junior_title,
                    to_value=title,
                )
                EmployeeLog.objects.filter(pk=log.pk).update(
                    created_at=timezone.make_aware(
                        datetime.combine(promoted_on, datetime.min.time().replace(hour=10))
                    )
                )
        return created

    def _assign_managers(self, employees, departments):
        # First employee in each department (by code) becomes that dept's manager.
        by_dept = {}
        for emp in employees:
            by_dept.setdefault(emp.department_id, []).append(emp)
        for dept_emps in by_dept.values():
            manager = dept_emps[0]
            for emp in dept_emps[1:]:
                if emp.manager_id is None:
                    emp.manager = manager
                    emp.save(update_fields=["manager"])

    def _seed_attendance(self, employees):
        today = date.today()
        active = [e for e in employees if e.employment_status == Employee.EmploymentStatus.ACTIVE]
        for emp in active:
            for delta in range(1, 31):
                day = today - timedelta(days=delta)
                if day.weekday() >= 5:  # Sat/Sun
                    continue
                if AttendanceLog.objects.filter(employee=emp, date=day).exists():
                    continue
                status = random.choices(
                    [
                        AttendanceLog.Status.PRESENT,
                        AttendanceLog.Status.LATE,
                        AttendanceLog.Status.HALF_DAY,
                        AttendanceLog.Status.ABSENT,
                    ],
                    weights=[0.78, 0.12, 0.05, 0.05],
                )[0]
                check_in = timezone.make_aware(
                    datetime(day.year, day.month, day.day, 9 if status != AttendanceLog.Status.LATE else 10, random.randint(0, 55))
                ) if status != AttendanceLog.Status.ABSENT else None
                check_out = (
                    check_in + timedelta(hours=8) if check_in and status != AttendanceLog.Status.HALF_DAY else
                    (check_in + timedelta(hours=4) if check_in else None)
                )
                AttendanceLog.objects.create(
                    employee=emp, date=day, status=status, check_in_time=check_in, check_out_time=check_out
                )

    def _seed_leave(self, employees):
        types = {}
        for name, code, paid, quota in [
            ("Annual Leave", "ANNUAL", True, 18),
            ("Sick Leave", "SICK", True, 12),
            ("Casual Leave", "CASUAL", True, 7),
            ("Unpaid Leave", "UNPAID", False, 0),
        ]:
            types[code], _ = LeaveType.objects.get_or_create(
                code=code, defaults={"name": name, "is_paid": paid, "annual_quota_days": quota}
            )
        today = date.today()

        # **Seasonal, because that is the fact the chart exists to show.**
        # Dashain and Tihar fall in Ashwin–Kartik and move a large share of the
        # year's days into two months; a roster planned without knowing that is
        # a roster that breaks. The weights below are per calendar month, and
        # October and November carry roughly three times an ordinary month.
        festival_weight = {
            1: 1, 2: 1, 3: 2, 4: 2, 5: 1, 6: 1,
            7: 1, 8: 2, 9: 3, 10: 6, 11: 5, 12: 2,
        }
        pool = [e for e in employees if e.employment_status == Employee.EmploymentStatus.ACTIVE]
        if not pool:
            return

        for months_back in range(12, -2, -1):
            # Walk back whole months from the first of this one.
            anchor = date(today.year, today.month, 1) - timedelta(days=31 * months_back)
            anchor = date(anchor.year, anchor.month, 1)
            for _ in range(festival_weight.get(anchor.month, 1) + 1):
                employee = random.choice(pool)
                # Sick leave is not seasonal and annual leave is, so the mix
                # shifts rather than the volume alone.
                if anchor.month in (10, 11):
                    leave_type = types["ANNUAL"] if random.random() < 0.75 else types["CASUAL"]
                else:
                    leave_type = random.choice(list(types.values()))

                day = random.randint(1, 26)
                start = date(anchor.year, anchor.month, day)
                length = random.randint(1, 5 if anchor.month in (10, 11) else 3)
                end = start + timedelta(days=length - 1)
                if LeaveRequest.objects.filter(employee=employee, start_date=start).exists():
                    continue

                # The past is settled; the future is still being decided. A
                # queue of pending requests dated last year would be a queue
                # nobody had looked at in a year.
                if start < today:
                    status = random.choice(
                        [LeaveRequest.Status.APPROVED] * 4 + [LeaveRequest.Status.REJECTED]
                    )
                else:
                    status = random.choice(
                        [LeaveRequest.Status.PENDING] * 3 + [LeaveRequest.Status.APPROVED]
                    )

                LeaveRequest.objects.create(
                    employee=employee,
                    leave_type=leave_type,
                    start_date=start,
                    end_date=end,
                    days_requested=Decimal(length),
                    reason=random.choice(
                        ["Family function", "Medical", "Personal work", "Dashain at home",
                         "Tihar", "Travel", "Child's exams", "Wedding in the family"]
                    ),
                    status=status,
                    is_paid=leave_type.is_paid,
                )

    def _seed_holidays(self):
        for name, day in HOLIDAYS_2026:
            Holiday.objects.get_or_create(date=day, name=name)

    def _seed_training(self, employees):
        programs = []
        for title, category, mode in [
            ("Workplace Safety 101", "Compliance", TrainingProgram.DeliveryMode.IN_PERSON),
            ("Advanced React", "Technical", TrainingProgram.DeliveryMode.ONLINE),
            ("Leadership Essentials", "Soft Skills", TrainingProgram.DeliveryMode.HYBRID),
            ("Financial Compliance", "Compliance", TrainingProgram.DeliveryMode.IN_PERSON),
        ]:
            prog, _ = TrainingProgram.objects.get_or_create(
                title=title, defaults={"category": category, "delivery_mode": mode, "description": f"{title} for staff."}
            )
            programs.append(prog)

        now = timezone.now()
        for prog in programs:
            if prog.sessions.exists():
                continue
            session = TrainingSession.objects.create(
                program=prog,
                start_datetime=now + timedelta(days=random.randint(3, 30), hours=1),
                end_datetime=now + timedelta(days=random.randint(3, 30), hours=4),
                location=random.choice(["Training Room A", "Zoom", "Boardroom", "Auditorium"]),
                capacity=random.choice([0, 15, 20]),
            )
            for emp in random.sample(employees, k=min(6, len(employees))):
                Enrollment.objects.get_or_create(
                    session=session,
                    employee=emp,
                    defaults={
                        "status": random.choice(
                            [Enrollment.Status.REQUESTED, Enrollment.Status.ENROLLED, Enrollment.Status.COMPLETED]
                        ),
                        "score": random.choice([None, 78, 85, 92]),
                    },
                )

    def _seed_wfh(self, employees):
        if WFHRequest.objects.exists():
            return
        today = date.today()
        statuses = [WFHRequest.Status.APPROVED, WFHRequest.Status.APPROVED, WFHRequest.Status.PENDING, WFHRequest.Status.REJECTED]
        notes = ["Kathmandu", "Pokhara (hometown)", "", "Bhaktapur"]
        for emp in employees[:10]:
            start = today + timedelta(days=random.randint(-5, 10))
            end = start + timedelta(days=random.randint(0, 4))
            WFHRequest.objects.create(
                employee=emp,
                start_date=start,
                end_date=end,
                work_location=random.choice([WFHRequest.WorkLocation.HOME, WFHRequest.WorkLocation.REMOTE]),
                location_note=random.choice(notes),
                reason=random.choice(["Focus work", "Family reasons", "Commute/traffic", "Festival travel"]),
                status=random.choice(statuses),
            )

    def _seed_recruitment(self, departments):
        jobs_spec = [
            ("Senior Backend Engineer", "Engineering", "Kathmandu / Remote", "full_time", "open", 2, (150000, 250000)),
            ("Product Designer", "Marketing", "Lalitpur", "full_time", "open", 1, (120000, 180000)),
            ("HR Officer", "Human Resources", "Kathmandu", "full_time", "open", 1, (70000, 110000)),
            ("Sales Executive", "Sales", "Pokhara", "full_time", "open", 3, (60000, 90000)),
            ("DevOps Intern", "Engineering", "Remote", "internship", "draft", 1, (25000, 35000)),
        ]
        first_names = ["Sabin", "Riya", "Kushal", "Manisha", "Arjun", "Sneha", "Bibek", "Pratima", "Nabin", "Asmita"]
        last_names = ["Shrestha", "Karki", "Gurung", "Rai", "Thapa", "Bhandari", "Koirala", "Baral"]
        stages = list(Candidate.Stage.values)
        sources = ["LinkedIn", "Referral", "Job Board", "Website"]

        for title, dept, loc, etype, jstatus, openings, (smin, smax) in jobs_spec:
            job, created = JobPosting.objects.get_or_create(
                title=title,
                defaults={
                    "department": departments.get(dept),
                    "location": loc,
                    "employment_type": etype,
                    "status": jstatus,
                    "openings": openings,
                    "salary_min": smin,
                    "salary_max": smax,
                    "description": f"We're hiring a {title}. Join our team in Nepal.",
                },
            )
            if not created or jstatus == "draft":
                continue
            for _ in range(random.randint(3, 7)):
                Candidate.objects.create(
                    job=job,
                    name=f"{random.choice(first_names)} {random.choice(last_names)}",
                    email="candidate@example.com",
                    phone=f"+977-98{random.randint(10000000, 49999999)}",
                    # Weighted by name, not by position. A positional list
                    # silently desynchronised when Phase 27 added DECLINED to
                    # the enum, and `random.choices` only caught it because the
                    # lengths happened to differ — a *reordered* enum would have
                    # skewed the funnel with no error at all.
                    stage=random.choices(
                        stages, weights=[STAGE_WEIGHTS.get(s, 0.05) for s in stages]
                    )[0],
                    rating=random.choice([None, 3, 4, 4, 5]),
                    source=random.choice(sources),
                )

    def _seed_crm(self, employees):
        owners = employees[:6]
        clients = []
        for name, industry in CLIENTS:
            client, _ = Client.objects.get_or_create(name=name, defaults={"industry": industry})
            clients.append(client)
            Contact.objects.get_or_create(
                client=client,
                name=f"Contact at {name}",
                defaults={"email": f"contact@{name.split()[0].lower()}.com.np", "phone": "+977-1-4000000"},
            )
            # A spread of deals across every stage for a meaningful pipeline/kanban.
            if not client.deals.exists():
                for stage in list(Deal.Stage.values):
                    Deal.objects.create(
                        client=client,
                        title=f"{name} — {stage} deal",
                        stage=stage,
                        value=Decimal(random.randint(200000, 5000000)),
                        expected_close_date=date.today() + timedelta(days=random.randint(-20, 90)),
                        owner=random.choice(owners) if owners else None,
                    )
        # Projects + tasks + invoices (also used by timesheets).
        #
        # Named from `HYDRO_PROJECTS` rather than after the client. A
        # generation company's projects are its plant, its next plant and the
        # capital works around them — naming them after the offtaker and the
        # regulator would describe a consultancy's model instead.
        projects = []
        for i, client in enumerate(clients):
            name, description, status = HYDRO_PROJECTS[i % len(HYDRO_PROJECTS)]
            if i >= len(HYDRO_PROJECTS):
                # More clients than named works. Rather than a "— phase 2"
                # suffix, which reads as a placeholder, say plainly which year's
                # programme this is.
                name = f"{name} ({date.today().year - 1})"
            proj, created = Project.objects.get_or_create(
                client=client, name=name,
                defaults={"status": status,
                          "description": description,
                          "start_date": date.today() - timedelta(days=random.randint(20, 150)),
                          "owner": random.choice(owners) if owners else None})
            projects.append(proj)
            if created:
                # Spread across the real states rather than a done/not-done
                # coin flip — a board seeded with only two columns occupied
                # cannot show whether the board works.
                task_states = [
                    ProjectTask.Status.TODO,
                    ProjectTask.Status.IN_PROGRESS,
                    ProjectTask.Status.BLOCKED,
                    ProjectTask.Status.IN_REVIEW,
                    ProjectTask.Status.DONE,
                    ProjectTask.Status.DONE,
                ]
                # Real work, not "Milestone 1..6". A board is meant to be read
                # at a glance, and six identically-named cards say nothing about
                # what the team is doing — which makes every board screenshot
                # look like a placeholder.
                work = [
                    "Desanding basin gate overhaul",
                    "Penstock expansion joint inspection",
                    "Switchyard relay coordination study",
                    "Access road culvert repair",
                    "Tailrace silt survey",
                    "Generator winding resistance test",
                    "SCADA point list reconciliation",
                    "Right-of-way vegetation clearing",
                    "Spillway gate hoist servicing",
                    "Environmental monitoring report — quarter",
                    "NEA joint metering reconciliation",
                    "Powerhouse crane load test",
                ]
                for t in range(random.randint(3, 6)):
                    state = random.choice(task_states)
                    # Scheduled in sequence from the project's start, each
                    # running a few days to a fortnight, so the timeline has
                    # something to place and the plan reads as a plan rather
                    # than as a pile. Undated tasks fall into the "no dates set"
                    # note instead of onto the chart.
                    started = proj.start_date + timedelta(days=t * random.randint(6, 16))
                    length = random.randint(3, 14)
                    ProjectTask.objects.create(
                        project=proj,
                        title=work[(i * 5 + t) % len(work)],
                        status=state,
                        priority=random.choice(
                            [p for p, _ in ProjectTask.Priority.choices]
                        ),
                        start_date=started,
                        due_date=started + timedelta(days=length),
                        estimate_hours=Decimal(length * 4),
                        completed_at=timezone.now() if state == ProjectTask.Status.DONE else None,
                        assignee=random.choice(owners) if owners else None,
                        order=t,
                    )
                inv, _ = Invoice.objects.get_or_create(number=f"INV-{3000 + i}", defaults={
                    "client": client, "project": proj, "issue_date": date.today() - timedelta(days=random.randint(1, 30)),
                    "due_date": date.today() + timedelta(days=15), "status": random.choice(["draft", "sent", "paid"])})
                for li in range(random.randint(1, 3)):
                    InvoiceLineItem.objects.create(invoice=inv, order=li,
                        description=random.choice(["Civil works", "Electromechanical supply", "Site supervision", "Survey and design"]),
                        quantity=Decimal(random.randint(1, 8)), unit_price=Decimal(random.choice([8000, 15000, 30000])))
        return projects

    # ---------------- newer modules (Phase 14-17) ----------------
    def _seed_company_profile(self):
        profile = CompanyProfile.get_solo()
        if profile.name in ("", "My Company", "SignCo Pvt. Ltd."):
            profile.name = COMPANY_NAME
            profile.address = COMPANY_ADDRESS
            # Sunday to Friday. Nepal's working week is not the Western one,
            # and a demo that says otherwise gets every date calculation on
            # screen subtly wrong for the country it is built for.
            #
            # ISO weekdays — Monday is 1, Sunday is 7. `is_working_day`
            # compares against `isoweekday()`, so a week written in Python's
            # `date.weekday()` dialect (Monday 0) shifts every day by one and
            # charges Saturday, the Nepali weekend, as a working day. Set
            # membership cannot fail loudly, so the only symptom would be leave
            # balances quietly computed against the wrong week.
            profile.working_days = [7, 1, 2, 3, 4, 5]
            # Office hours, so a demo company can actually see the features that
            # depend on them. `office_start_time` is nullable on purpose — a
            # workspace that never sets one never marks anybody late — but the
            # arrival distribution has nothing to compare against without it,
            # and the seeded punches are all built around a 9am start anyway.
            profile.office_start_time = dt_time(9, 0)
            profile.office_end_time = dt_time(18, 0)
            # Nine to six less an hour for lunch is an eight-hour day. Without
            # this the fulfilment dial measures against the span and reports
            # nine, which tells somebody they are nearly done an hour after
            # they finished.
            profile.unpaid_break_minutes = 60
            profile.save()

    def _seed_payroll(self, employees):
        from payroll.models import (
            PayrollRun,
            SalaryComponent,
            SalaryStructure,
            SalaryStructureAssignment,
            SalaryTemplate,
            SalaryTemplateLine,
            TaxSlab,
        )
        basic = SalaryComponent.objects.get_or_create(code="basic", defaults={
            "name": "Basic Salary", "component_type": "earning", "calc_type": "flat", "order": 1})[0]
        house = SalaryComponent.objects.get_or_create(code="house_allowance", defaults={
            "name": "House Allowance", "component_type": "earning", "calc_type": "percentage_of",
            "percentage_of": basic, "amount": Decimal("20"), "order": 2})[0]
        transport = SalaryComponent.objects.get_or_create(code="transport", defaults={
            "name": "Transport", "component_type": "earning", "calc_type": "flat", "order": 3})[0]
        # **No hand-built retirement component here, deliberately.**
        #
        # A "Provident Fund" deduction with its percentage typed onto the
        # component would misrepresent the product twice over: it hides
        # `StatutoryRate`, where the figure belongs, and it collides with the
        # company scheme the moment somebody switches one on — deducting the
        # same obligation twice off the same basic.
        #
        # **And which fund a company is on is the owner's decision**, not a
        # seed's. A demo company therefore starts with *no* scheme chosen, the
        # same as a real one, and shows the choice being made rather than
        # arriving pre-made. `payroll/schemes.py` is the mechanism.
        tax = SalaryComponent.objects.get_or_create(code="income_tax", defaults={
            "name": "Income Tax", "component_type": "deduction", "calc_type": "slab_based", "order": 5})[0]
        # The company's fiscal year, the way `seed_statutory_rates` and
        # `seed_depth` do it. `date.today().year` is a Gregorian year keying a
        # table payroll looks up by the *company's* fiscal year — on a Bikram
        # Sambat company every lookup misses and income tax computes as zero
        # (D-06).
        # Both fiscal years, not just this one. Six monthly periods straddle a
        # year boundary, and `compute_payslip` refuses a period whose fiscal
        # year has no bands — correctly, because a run that taxes at zero looks
        # exactly like a correct one (D-18).
        this_fy = company_calendar().fiscal_year_of(date.today())
        bands = [(0, 500000, 1), (500000, 700000, 10), (700000, 1000000, 20), (1000000, None, 30)]
        for fy in (this_fy - 1, this_fy):
            for i, (mn, mx, rate) in enumerate(bands):
                TaxSlab.objects.get_or_create(fiscal_year=fy, order=i + 1, defaults={
                    "min_amount": Decimal(mn), "max_amount": Decimal(mx) if mx else None, "rate": Decimal(rate)})
        # Two named structures, because a hydropower company does not pay a
        # control-room operator on the same terms as an accounts officer — and
        # because a template screen with nothing on it teaches nobody what a
        # template is for. Deliberately left *unapplied* to most of the
        # workforce: the demo should show the "sixty people are not on pay yet"
        # state, which is the one the bulk action exists for.
        head_office, _ = SalaryTemplate.objects.get_or_create(
            name="Head office officer",
            defaults={
                "description": "Butwal-based staff on general shift.",
                "is_default": True,
            },
        )
        plant, _ = SalaryTemplate.objects.get_or_create(
            name="Plant operator",
            defaults={"description": "Powerhouse staff on rotating shifts, Seti Nadi."},
        )
        for template, base, travel in ((head_office, 62000, 3000), (plant, 48000, 6500)):
            for component, amount in (
                (basic, Decimal(base)),
                (transport, Decimal(travel)),
                (house, None),
                (tax, None),
            ):
                SalaryTemplateLine.objects.get_or_create(
                    template=template, component=component, defaults={"amount": amount}
                )

        paid = [e for e in employees if e.employment_status == Employee.EmploymentStatus.ACTIVE][:12]
        for e in paid:
            struct, created = SalaryStructure.objects.get_or_create(employee=e, effective_from=e.date_joined)
            if created:
                base = Decimal(random.choice([45000, 60000, 80000, 110000]))
                SalaryStructureAssignment.objects.get_or_create(structure=struct, component=basic, defaults={"amount": base})
                SalaryStructureAssignment.objects.get_or_create(structure=struct, component=transport, defaults={"amount": Decimal(3000)})
                SalaryStructureAssignment.objects.get_or_create(structure=struct, component=house)
                SalaryStructureAssignment.objects.get_or_create(structure=struct, component=tax)
        # The previous period in the *company's* calendar, so seeded data
        # exercises the same path a real run takes (D-06).
        # **Six periods, not one.** A single run gives every payroll screen a
        # series of length one: no trend to draw, no month to compare against,
        # and the "gross to net by period" chart has one bar. Six is enough to
        # see a shape and cheap enough to seed.
        #
        # The last of them is left as a **draft** on purpose. A demo where every
        # run is closed never shows the state somebody actually spends their
        # time in — the one they are checking before they finalise it.
        from payroll.services import compute_payslip

        calendar = company_calendar()
        this_period = calendar.from_gregorian(date.today())
        p_year, p_month = this_period.year, this_period.month

        periods = []
        for _ in range(6):
            p_month -= 1
            if p_month == 0:
                p_year, p_month = p_year - 1, 12
            periods.append((p_year, p_month))
        periods.reverse()  # oldest first, so the series reads left to right

        for index, (year, month) in enumerate(periods):
            run, created = PayrollRun.objects.get_or_create(
                period_calendar=calendar.key, period_year=year, period_month=month,
                defaults={"status": "draft"})
            if not created:
                continue
            failures = []
            for e in paid:
                try:
                    compute_payslip(run, e)
                except Exception as exc:  # noqa: BLE001
                    # Reported rather than swallowed. A silent `pass` here hid
                    # four empty payroll runs behind a "seeded successfully",
                    # and an empty run is indistinguishable from a working one
                    # in a demo until somebody opens it.
                    failures.append(str(exc).split(".")[0])
            if failures:
                self.stderr.write(
                    self.style.WARNING(
                        f"  ! {run.period_label}: {len(failures)} payslip(s) skipped — {failures[0]}"
                    )
                )
            if index == len(periods) - 1:
                # The newest one stays open, mid-review — but its totals are
                # still recalculated. A draft holding twelve payslips that
                # reports a count of zero is the same lie as an empty run.
                run.recalculate_totals()
                continue
            run.status = "completed"
            run.save(update_fields=["status"])
            run.payslips.update(status="finalized")
            # `.update()` skips `save()`, and the run's denormalised totals are
            # maintained there — without this every seeded run reported a net
            # of zero while holding twelve real payslips.
            run.recalculate_totals()

    def _seed_shifts(self, employees):
        """Three shifts on the powerhouse, one for head office.

        **The reason the demo company is a hydropower operator.** A plant does
        not close, so night work, a night allowance and a shift-specific unpaid
        break are ordinary facts here rather than settings nobody ever turns on
        — and they exercise the parts of attendance and payroll that an office
        roster leaves untouched.
        """
        from attendance.models import Shift, ShiftAssignment

        shifts = {}
        for name, start, end, grace, night, allowance, brk in SHIFTS:
            shifts[name], _ = Shift.objects.get_or_create(
                name=name,
                defaults={
                    "start_time": dt_time(*start),
                    "end_time": dt_time(*end),
                    "grace_period_minutes": grace,
                    "is_night_shift": night,
                    "night_allowance": Decimal(allowance),
                    "unpaid_break_minutes": brk,
                },
            )

        rotation = [
            shifts["Day (Powerhouse)"],
            shifts["Evening (Powerhouse)"],
            shifts["Night (Powerhouse)"],
        ]
        started = date.today() - timedelta(days=90)

        for employee in employees:
            department = employee.department.name if employee.department else ""
            if department == "Plant Operations":
                # Rotated deterministically by employee id, so the same person
                # keeps the same shift between runs of the seed and anybody
                # reading the demo twice sees a consistent roster.
                shift = rotation[employee.id % len(rotation)]
            else:
                shift = shifts["General (Head office)"]
            ShiftAssignment.objects.get_or_create(
                employee=employee,
                shift=shift,
                start_date=started,
                defaults={"end_date": None},
            )

    def _seed_field_visits(self, employees, projects):
        """Site visits — the thing a plant eight hours from head office makes
        constantly, and the thing a generic demo has none of.

        Deliberately seeded across four modules at once, because that is what a
        field visit actually is: a **task** on a project, **hours** on a
        timesheet, a **travel claim** afterwards, and a **document** filed at
        the end. Seeding it as four unrelated rows would look the same in a
        table and behave like nothing at all.
        """
        from expenses.models import ExpenseClaim
        from projects.models import ProjectTask
        from timesheets.models import TimeEntry

        if not projects or not employees:
            return

        site_people = [
            e
            for e in employees
            if e.department
            and e.department.name
            in ("Civil & Hydromechanical", "Environment & Social", "Electrical & Transmission")
        ] or employees[:6]

        for index, (title, place, days) in enumerate(FIELD_VISITS):
            project = projects[index % len(projects)]
            person = site_people[index % len(site_people)]
            went = date.today() - timedelta(days=7 * (index + 1))

            task, _ = ProjectTask.objects.get_or_create(
                project=project,
                title=title,
                defaults={
                    "description": f"Field visit — {place}. {days} day(s) on site.",
                    "status": ProjectTask.Status.DONE if index % 3 else ProjectTask.Status.IN_PROGRESS,
                    "assignee": person,
                    "start_date": went,
                    "due_date": went + timedelta(days=days),
                    "estimate_hours": Decimal(days * 8),
                },
            )

            for day_offset in range(days):
                TimeEntry.objects.get_or_create(
                    employee=person,
                    project=project,
                    date=went + timedelta(days=day_offset),
                    defaults={
                        "task": task,
                        "hours": Decimal("8.00"),
                        "description": f"{title} — {place}",
                        "billable": False,
                    },
                )

            # Travel and per-diem, at the rates a site visit actually attracts.
            ExpenseClaim.objects.get_or_create(
                employee=person,
                title=f"Field visit — {place}",
                expense_date=went + timedelta(days=days),
                defaults={
                    "category": ExpenseClaim.Category.TRAVEL,
                    "amount": Decimal(2500 * days + 1800),
                    "description": (
                        f"Return travel to {place}, {days} night(s) accommodation "
                        "and per-diem."
                    ),
                    "status": [
                        ExpenseClaim.Status.REIMBURSED,
                        ExpenseClaim.Status.APPROVED,
                        ExpenseClaim.Status.PENDING,
                    ][index % 3],
                },
            )

    def _seed_expenses(self, employees, hr):
        if ExpenseClaim.objects.exists():
            return
        cats = ["travel", "meals", "supplies", "software", "training", "other"]
        for e in random.sample(employees, min(14, len(employees))):
            st = random.choice(["pending", "approved", "reimbursed", "rejected"])
            ExpenseClaim.objects.create(
                employee=e, title=random.choice(["Client visit", "Team lunch", "Software licence", "Course fee", "Taxi"]),
                category=random.choice(cats), amount=Decimal(random.choice([1200, 3500, 8000, 15000, 22000])),
                expense_date=date.today() - timedelta(days=random.randint(1, 45)), status=st,
                decided_by=hr.user if (hr and st != "pending") else None,
                decided_at=timezone.now() if st != "pending" else None,
                reimbursed_at=timezone.now() if st == "reimbursed" else None)

    def _seed_documents(self):
        for title, cat in [("Employee Handbook", "handbook"), ("Leave Policy", "policy"), ("Expense Claim Form", "form")]:
            if RepositoryDocument.objects.filter(title=title).exists():
                continue
            doc = RepositoryDocument(title=title, category=cat, visibility="company",
                description=f"{title} (demo).", original_filename=f"{title}.txt")
            doc.file.save(f"{title}.txt", ContentFile(f"{title}\n\nDemo content.".encode()), save=True)

    def _seed_checklists(self, employees):
        if Checklist.objects.exists():
            return
        onb = ChecklistTemplate.objects.get_or_create(name="New Hire Onboarding", kind="onboarding")[0]
        for i, t in enumerate(["Sign contract", "Set up laptop", "HR orientation", "Meet the team", "Tool access"]):
            ChecklistTemplateItem.objects.get_or_create(template=onb, title=t, defaults={"order": i, "due_offset_days": i + 1})
        off = ChecklistTemplate.objects.get_or_create(name="Offboarding", kind="offboarding")[0]
        for i, t in enumerate(["Return assets", "Revoke access", "Exit interview", "Final settlement"]):
            ChecklistTemplateItem.objects.get_or_create(template=off, title=t, defaults={"order": i, "due_offset_days": i})
        for e in employees[:3]:
            cl = Checklist.objects.create(employee=e, kind="onboarding", template=onb, title="New Hire Onboarding", status="active")
            for i, item in enumerate(onb.items.all()):
                ChecklistTask.objects.create(checklist=cl, title=item.title, order=i,
                    due_date=date.today() + timedelta(days=item.due_offset_days),
                    status="done" if i < 2 else "pending", completed_at=timezone.now() if i < 2 else None)
            cl.refresh_status()

    def _seed_timesheets(self, employees, projects):
        if not projects or TimeEntry.objects.exists():
            return
        for e in employees[:10]:
            for _ in range(random.randint(2, 5)):
                TimeEntry.objects.create(employee=e, project=random.choice(projects),
                    date=date.today() - timedelta(days=random.randint(0, 20)),
                    hours=Decimal(random.choice(["2.5", "4", "6", "8"])), description="Project work",
                    status=random.choice(["submitted", "approved", "approved"]))

    def _seed_goals(self, employees):
        if Objective.objects.exists():
            return
        company = Objective.objects.create(owner=None, title="Grow ARR to NPR 50M", period="FY2026", status="active")
        for t, s, tg, cur, unit in [("New logos", 0, 40, 22, "clients"), ("Net revenue retention", 90, 120, 108, "%")]:
            KeyResult.objects.create(objective=company, title=t, start_value=s, target_value=tg, current_value=cur, unit=unit)
        for e in employees[:5]:
            o = Objective.objects.create(owner=e, title=random.choice(["Ship v2", "Improve NPS", "Close Q3 deals"]),
                period="Q3 2026", status="active")
            for k in range(2):
                tgt = random.choice([10, 100, 5])
                KeyResult.objects.create(objective=o, title=f"KR {k + 1}", start_value=0, target_value=tgt,
                    current_value=random.randint(0, tgt), unit=random.choice(["", "%", "deals"]))

    def _seed_assets(self, employees):
        if Asset.objects.exists():
            return
        cats = ["laptop", "monitor", "phone", "desktop", "furniture"]
        for i in range(14):
            cat = cats[i % len(cats)]
            a = Asset.objects.create(name=f"{cat.title()} #{i + 1}", asset_tag=f"AST-{100 + i}",
                category=cat, serial_number=f"SN{random.randint(10000, 99999)}", status="available")
            if i < 8:
                e = employees[i % len(employees)]
                AssetAssignment.objects.create(asset=a, employee=e,
                    assigned_at=date.today() - timedelta(days=random.randint(5, 200)))
                a.assigned_to = e
                a.status = "assigned"
                a.save(update_fields=["assigned_to", "status"])
            elif i == 12:
                a.status = "maintenance"
                a.save(update_fields=["status"])

    def _seed_helpdesk(self, employees, hr):
        if Ticket.objects.exists():
            return
        subs = [("Laptop will not boot", "it", "high"), ("Payslip discrepancy", "payroll", "medium"),
                ("AC not working", "facilities", "low"), ("Need VPN access", "it", "urgent"),
                ("Update emergency contact", "hr", "low"), ("Broken chair", "facilities", "medium"),
                ("Software licence request", "it", "medium"), ("Leave balance query", "hr", "low")]
        for i, (subj, cat, pri) in enumerate(subs):
            req = employees[i % len(employees)]
            st = ["open", "in_progress", "resolved", "closed"][i % 4]
            t = Ticket.objects.create(subject=subj, description="Please help.", category=cat, priority=pri,
                status=st, requester=req, assignee=hr if (hr and st != "open") else None,
                resolved_at=timezone.now() if st == "resolved" else None)
            if hr and st != "open":
                TicketComment.objects.create(ticket=t, body="Looking into this.", created_by=hr.user)

    def _seed_surveys(self, employees):
        if Survey.objects.exists():
            return
        s = Survey.objects.create(title="Q3 Employee Pulse", status="active", anonymous=True)
        q_nps = SurveyQuestion.objects.create(survey=s, text="How likely are you to recommend us as a place to work?", kind="nps", order=0)
        q_txt = SurveyQuestion.objects.create(survey=s, text="What could we improve?", kind="text", order=1)
        for _ in range(min(12, len(employees))):
            resp = SurveyResponse.objects.create(survey=s, respondent=None)
            SurveyAnswer.objects.create(response=resp, question=q_nps, numeric_value=random.choice([10, 9, 9, 8, 7, 6, 5, 9, 10, 8]))
            SurveyAnswer.objects.create(response=resp, question=q_txt, text_value=random.choice(
                ["More flexibility", "Better tools", "Nothing, great!", "Clearer goals"]))
        s2 = Survey.objects.create(title="Onboarding Feedback", status="closed", anonymous=False)
        q2 = SurveyQuestion.objects.create(survey=s2, text="Rate your onboarding", kind="scale5", order=0)
        for e in random.sample(employees, min(6, len(employees))):
            r = SurveyResponse.objects.create(survey=s2, respondent=e)
            SurveyAnswer.objects.create(response=r, question=q2, numeric_value=random.randint(3, 5))

    def _seed_reviews(self, employees):
        cycle = ReviewCycle.objects.get_or_create(name="H1 2026 Review", defaults={
            "start_date": date.today() - timedelta(days=30), "end_date": date.today() + timedelta(days=15), "status": "active"})[0]
        for e in employees[:10]:
            Review.objects.get_or_create(cycle=cycle, employee=e, defaults={
                "reviewer": e.manager, "status": random.choice(["pending_self", "pending_manager", "completed"]),
                "self_rating": random.randint(3, 5), "manager_rating": random.randint(3, 5)})

    def _seed_announcements(self, employees, departments):
        """The notice board.

        Empty until now, which made the page look broken rather than unused —
        and an announcement board is one of the few screens where an empty state
        is genuinely ambiguous: nobody can tell "this company posts nothing"
        from "this feature does not work".

        Dated backwards at irregular intervals rather than all at once, because
        eight notices sharing a timestamp read as an import, not as a year of a
        company talking to itself.
        """
        from notifications.models import Announcement

        author = employees[0] if employees else None
        for index, (title, body, department_name, pinned) in enumerate(ANNOUNCEMENTS):
            department = departments.get(department_name) if department_name else None
            announcement, created = Announcement.objects.get_or_create(
                title=title,
                defaults={"body": body, "department": department, "pinned": pinned},
            )
            if created:
                # `created_at` is auto_now_add, so it has to be written after
                # the insert. Spread over roughly four months.
                Announcement.objects.filter(pk=announcement.pk).update(
                    created_at=timezone.now() - timedelta(days=3 + index * 14 + index % 3),
                    created_by=author.user if author else None,
                )

    def _seed_client_tickets(self, employees):
        """The client desk, with its clocks in every meaningful position.

        **The states are the point.** A queue seeded with eight open tickets
        cannot show that the two clocks do different work — one ticket answered
        late, another answered fast, a third never answered and now in breach.
        Those are the three cases the SLA columns exist to distinguish, so all
        three are seeded.
        """
        from crm.models import Client as CRMClient
        from crm.models import ClientTicket

        # Read rather than threaded through `_seed_crm`'s return value: that
        # returns projects, and widening it to a tuple would make every caller
        # unpack something they do not use.
        clients = list(CRMClient.objects.order_by("id"))
        if not clients:
            return

        handlers = [e for e in employees if e.department and e.department.name in
                    ("Company Secretariat", "Finance & Accounts", "Environment & Social")] or employees[:4]

        for index, (client_index, subject, description, priority, channel, state) in enumerate(CLIENT_TICKETS):
            client = clients[client_index % len(clients)]
            raised = timezone.now() - timedelta(days=2 + index * 4, hours=index * 3)
            # Targets a real SLA policy would set. Snapshotted onto the ticket,
            # the same as the service does, so changing the policy later cannot
            # retroactively rescue or condemn these.
            response_due = raised + timedelta(hours={"urgent": 4, "high": 8, "normal": 24, "low": 48}[priority])
            resolution_due = raised + timedelta(days={"urgent": 1, "high": 3, "normal": 5, "low": 10}[priority])

            first_response = None
            resolved = None
            status = "open"
            if state == "answered":
                first_response = raised + timedelta(hours=2)
                status = "in_progress"
            elif state == "resolved":
                first_response = raised + timedelta(hours=1)
                resolved = raised + timedelta(days=1)
                status = "resolved"
            elif state == "breaching":
                # Deliberately never answered and past due — the case the
                # breach columns exist for.
                raised = timezone.now() - timedelta(days=6)
                response_due = raised + timedelta(hours=4)
                resolution_due = raised + timedelta(days=1)
            else:
                # Genuinely open: raised recently enough that the response
                # window has not run out.
                #
                # SLA clocks set from the raise time, so open tickets are not
                # all in breach. A desk where everything is breached buries the
                # one deliberate breach the column exists to show.
                raised = timezone.now() - timedelta(hours=index + 1)
                response_due = raised + timedelta(
                    hours={"urgent": 4, "high": 8, "normal": 24, "low": 48}[priority]
                )
                resolution_due = raised + timedelta(
                    days={"urgent": 1, "high": 3, "normal": 5, "low": 10}[priority]
                )

            ticket, created = ClientTicket.objects.get_or_create(
                reference=f"CT-{1000 + index}",
                defaults={
                    "client": client,
                    "contact": client.contacts.first(),
                    "subject": subject,
                    "description": description,
                    "priority": priority,
                    "channel": channel,
                    "status": status,
                    "assignee": handlers[index % len(handlers)] if handlers else None,
                    "first_response_at": first_response,
                    "resolved_at": resolved,
                    "response_due_at": response_due,
                    "resolution_due_at": resolution_due,
                },
            )
            if created:
                ClientTicket.objects.filter(pk=ticket.pk).update(created_at=raised)

    def _seed_loans(self, employees):
        """Loans in every state the model supports.

        **Not routed through `activate_loan` on purpose.** That service edits
        the employee's salary structure to add a repayment deduction, which is
        the right behaviour in the product and the wrong behaviour in a seed —
        it would quietly rewrite the pay of whoever the seed happened to pick.
        These are records of loans in each state, not a simulation of the
        approval path.
        """
        from payroll.models import Loan

        borrowers = [e for e in employees if e.employment_status == Employee.EmploymentStatus.ACTIVE][:20]
        if not borrowers:
            return

        for index, (loan_type, principal, monthly, status, reason) in enumerate(LOANS):
            employee = borrowers[(index * 3) % len(borrowers)]
            if Loan.objects.filter(employee=employee, reason=reason).exists():
                continue

            outstanding = Decimal(principal)
            start = None
            closed = None
            if status == "active":
                start = date.today() - timedelta(days=90 + index * 30)
                # Three months paid down, so the outstanding balance is a
                # number somebody could check rather than the principal again.
                outstanding = max(Decimal(principal) - Decimal(monthly) * 3, Decimal(0))
            elif status == "closed":
                start = date.today() - timedelta(days=400)
                outstanding = Decimal(0)
                closed = timezone.now() - timedelta(days=30)
            elif status in ("requested", "rejected"):
                outstanding = Decimal(0) if status == "rejected" else Decimal(principal)

            Loan.objects.create(
                employee=employee,
                loan_type=loan_type,
                principal_amount=Decimal(principal),
                monthly_deduction=Decimal(monthly),
                outstanding_balance=outstanding,
                reason=reason,
                status=status,
                start_date=start,
                closed_at=closed,
            )

    def _seed_change_requests(self, employees, hr):
        """The approval queue for changes an employee asks for.

        Written directly rather than through `change_requests.request_change`,
        for the same reason as the loans above: the service applies an approved
        change to the employee record, and a seed that silently rewrote real
        bank details would be doing something a seed has no business doing. The
        approved rows here record that a decision was made, without moving
        anybody's salary.
        """
        from employees.models import EmployeeChangeRequest

        askers = [e for e in employees if e.employment_status == Employee.EmploymentStatus.ACTIVE][:20]
        if not askers:
            return

        for index, (field, new_value, reason, status) in enumerate(CHANGE_REQUESTS):
            employee = askers[(index * 5) % len(askers)]
            if EmployeeChangeRequest.objects.filter(employee=employee, field=field).exists():
                continue

            decided_at = None
            decided_by = None
            note = ""
            if status in ("approved", "rejected"):
                decided_at = timezone.now() - timedelta(days=index + 1)
                decided_by = hr.user if hr else None
                if status == "rejected":
                    # A refusal with no reason sends the employee back to HR by
                    # email to ask why, which is the loop the model exists to
                    # close — so the seed never shows one.
                    note = "Enrolment not yet confirmed by the fund. Please reapply with the SSF letter."

            request = EmployeeChangeRequest.objects.create(
                employee=employee,
                field=field,
                old_value=str(getattr(employee, field, "") or ""),
                new_value=new_value,
                reason=reason,
                status=status,
                decided_by=decided_by,
                decided_at=decided_at,
                decision_note=note,
            )
            # `created_at` is auto_now_add, so it has to be written after the
            # insert. Backdated on purpose: the queue's headline is the age of
            # the oldest waiting request, and a queue where everything arrived
            # today has nothing to say — which is the one state that cannot
            # show whether anybody is working it.
            EmployeeChangeRequest.objects.filter(pk=request.pk).update(
                created_at=timezone.now() - timedelta(days=index * 3 + 1)
            )

    def _seed_notifications(self, hr):
        if hr is None:
            return
        for verb, msg in [("leave_requested", "3 leave requests await your approval."),
                          ("expense_submitted", "New expense claim submitted."),
                          ("document_signature_requested", "Please sign the updated policy.")]:
            Notification.objects.create(recipient=hr.user, verb=verb, message=msg)
