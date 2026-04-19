#!/usr/bin/env python3
"""Build import manifest for Roam entries → Talos database."""

import json
import os
import re
from pathlib import Path
from datetime import datetime

VAULT = Path.home() / "Documents" / "Exocortex"
ROAM = VAULT / "Roam"
SOCIAL = ROAM / "social-chatter"
AUDIT = Path(__file__).parent

# --- Load audit lists ---
def load_list(filename):
    with open(AUDIT / filename) as f:
        return [line.strip() for line in f if line.strip()]

stubs = load_list("roam_stubs.txt")
people_raw = load_list("roam_audit_people.txt")
music_raw = load_list("roam_audit_music.txt")
media_raw = load_list("roam_audit_media.txt")
esoterica = load_list("roam_audit_esoterica.txt")
concepts = load_list("roam_audit_concepts.txt")
personal = load_list("roam_audit_personal.txt")
junk_raw = load_list("roam_audit_junk.txt")

# Parse prefixed lists
def parse_prefixed(lines):
    result = {}
    for line in lines:
        m = re.match(r'\[(\w+)\]\s+(.+)', line)
        if m:
            result[m.group(2)] = m.group(1)
    return result

people_map = parse_prefixed(people_raw)  # title -> person/artist/band
music_map = parse_prefixed(music_raw)    # title -> release/gear
media_map = parse_prefixed(media_raw)    # title -> book/film/tv/game/media

# --- Discard sets ---
DISCARD = {
    "4535", "4581", "697065", "B475", "delegated", "film.", "forward-ref",
    "Next", "Not the same as", "now known as", "previously known as",
    "some-day", "unlisted", "Untitled", "uplift.", "version_4", "º:**",
    # Roam meta
    "Personal Roam Theme", "Roam Features", "Roam Hacks",
    "Roam Theme: Split Screen", "Roam Theme: Roamness", "Templates",
    # Duplicate
    "Recipe: Stuffed Pepper Soup",
    # Fix source + discard
    "peronsal", "year)",
    # Metadata tags + discard
    "Roam-Highlights", "Quick Capture",
    # Metadata subsumption + discard
    "watched", "queued",
    # Light notes discard
    "Roam Resources", "Using Roam for Software Engineering PM", "ROAM", "Inbox",
}

# --- Reclassification overrides ---
# These override the default audit-list routing

ROUTE_OVERRIDE = {}

# junk → concepts
for t in ["-punk", "Pending Forward References", "specialized"]:
    ROUTE_OVERRIDE[t] = (["concepts"], "concept", None)

# junk → /projects/lzc
ROUTE_OVERRIDE["LZC"] = (["projects", "lzc"], "reference", None)

# personal → /data/recipes
for t in ["Banana Bread", "Navajo flat bread", "quiche"]:
    ROUTE_OVERRIDE[t] = (["data", "recipes"], "reference", None)

# personal → concepts
ROUTE_OVERRIDE["hors d'oeuvre"] = (["concepts"], "concept", None)

# personal → /projects/mushroom-cultivation
for t in ["brown rice flour", "fungus", "Psilocybe Cubensis", "Psylocybe Fanaticus",
          "spore syringe", "spores", "Sprouts", "sterility", "sterilization", "vermiculite"]:
    ROUTE_OVERRIDE[t] = (["projects", "mushroom-cultivation"], "reference", None)

# concepts → /data/people (band)
ROUTE_OVERRIDE["GrndNtl Brands"] = (["data", "people"], "reference", "band")

# esoterica → /projects/lzc
ROUTE_OVERRIDE["Lexington Zen Center: Abbot Notes"] = (["projects", "lzc"], "reference", None)

# Roam recipes
for t in ["Recipe: Red Lentil Curry", "Recipe: Red Beans and Rice",
          "Recipe: Chana Masala", "Recipe: Pumpkin Pie"]:
    ROUTE_OVERRIDE[t] = (["data", "recipes"], "reference", None)

# Roni → /data/relationships
ROUTE_OVERRIDE["Roni"] = (["data", "relationships"], "reference", None)

# Ultan entries → /writing/ultan/
ULTAN_TITLES = {
    "Channeling Sessions: Ultan Characters", "U:Theia", "U:Harharkh", "U:Karnak",
    "U:Night", "U:Ultan", "U:Foillan", "Beelzebub notes", "New Sun Units of Measure",
    "The Trick", "Djinn", "Ultan Sequel Ideas", "Looisos", "Theomertmalogos",
    "Ashhark", "Trogoautoegocrat (painting)", "Parable of the Choir",
}
for t in ULTAN_TITLES:
    ROUTE_OVERRIDE[t] = (["writing", "ultan"], "reference", None)

# Studio entries
STUDIO_TITLES = {
    "Live Setup", "song-titles", "List: Band Names",
    "Recent New Music", "Music Production Project Priorities",
}
for t in STUDIO_TITLES:
    ROUTE_OVERRIDE[t] = (["studio"], "reference", None)

# Standalone projects from Roam
PROJECT_TITLES = {
    "Project: Mushroom Cultivation", "Project: Oyakata - Sumo Simulator",
    "Project: Parallax - Roguelite Vertical Shooter", "Project: Western Trails",
    "Project: The Plague Album", "Project: Shit Sell-off",
    "Project: Enter Wonderland (DIY a Frequency Central Wonderland)",
    "Project: Backyard Soaking Tub", "Project: Better Computing Experience",
    "Project: Clean up Electronicsmithing Space", "Project: Divorce and House Refinance",
    "Project: Home Theater PC Build", "Project: Living Area Re-Paint",
    "Project: Morning Glory Cultivation", "Project: Personal Finance",
    "Project: Sitting Tub", "Project: Solar Roof", "Project: Solresol Esolang",
    "Project: Synology NAS", "Project: VPN Switch", "Project: VQGAN Tarot",
    "Project: Write an", "MtG Cube",
}
for t in PROJECT_TITLES:
    ROUTE_OVERRIDE[t] = (["projects"], "reference", None)

# LZC entries
ROUTE_OVERRIDE["Lexington Zen Center"] = (["projects", "lzc"], "reference", None)

# Adulting entries
ADULTING_TITLES = {
    "American Express Card", "Ashley Furniture Card", "AT&T Wireless",
    "Barclay's Card", "bills", "Chase Amazon Card", "Chiropractor", "Citi Card",
    "COVID", "craft-room", "Credence Resource Management", "Daily Exercise",
    "Daily Journal", "Daily Time Log", "doors and windows loan", "dopamine cleanse",
    "enamel pins", "Exercise: Neck and Shoulders", "Exercise: qi gong",
    "Exercise: Walk", "Exercise: yoga", "EyeBuyDirect",
    "Fireside Project", "Flea Fog Project", "Free Writing", "Geek Therapy",
    "Gift List", "Hawaiian Shirts", "Home Warranty", "Honey-Dos",
    "House: Central Air - Change Filter", "Household Tasks Board", "Inbox Zero",
    "Instant Pot", "Kentucky-American Water", "Laundry",
    "List: Home Improvement", "LSD", "measuring cups", "Metronet", "microdosing",
    "mixing bowl", "Monthly Bills", "morning exercise", "morning-page", "Mortgage",
    "My Anonamouse", "My Resume", "Nightly Review", "Open Ideas", "Open Questions",
    "organic food", "Personal Budget", "Physical Therapy Exercises",
    "piano repairman", "Positive Affirmations", "Reach Out",
    "Regular Home Maintenance Tasks", "Restaurants", "retirement",
    "screen printing", "Shopping List", "shopping-list", "Sketchpad", "Sleep Log",
    "strength training", "Subscription Services and Donations", "Taxes",
    "The Kentucky Theatre", "The United States", "Therapist", "This Week",
    "This Week's Shit", "Ticket", "TODO", "Trintellix",
    "Trip: Spring 2024 Solo Cabin Excursion", "Trip: Summer 2024 Florida Trip",
    "Upcoming Tasks", "Upcoming Week", "vacation trip", "Vitacost",
    "Week of July 12th, 2021", "weekend", "Wii Jailbreak", "Work and Hand Problems",
    "Writing Pitches", "Morning Meditation", "Morning Pages", "Morning Qigong",
    "Developing Good Habits", "Daily Education", "Daily Questions",
    "Evening Questions", "Three Daily Goals", "Yoga with Adriene",
    "Positive Disintegration", "Qigong",
    # From light notes
    "Adulting Plan", "University of Kentucky Sleep Disorder Center",
    "UK Physical Therapy", "Supplies", "college", "Research: Autism",
    "Environment Notes",
    # From substantive notes
    "Christmas Shopping List", "Domestic Priorities", "Goals",
    "Personal Information Display", "Template: Bills",
}
for t in ADULTING_TITLES:
    ROUTE_OVERRIDE[t] = (["projects", "adulting"], "reference", None)

# Work/unfiled entries
WORK_TITLES = {
    "CA-2111 - Intellicheck Holdsteady", "CA-2734 - Move client-herald to ecom-orc",
    "Financial Disclosure Form Integration", "Freshdesk Tickets", "Helm Migration",
    "Inventory Software Installation", "Job Application: Ivanti", "Job Hunt 2022",
    "LZC-1470: Investigating Invoice Submission 422 When Over Approved Amount",
    "PHP 8 Migration", "Pitch: AWS Reserved Instancing", "Pitch: Competencies",
    "Pitch: Email Infrastructure", "Pitch: Finance System Integration",
    "Pitch: Monitoring", "Pitch: Permissions Model", "Pitch: Permissions UX",
    "Pitch: PJC Transaction Management Tools", "Pitch: SCORM Cloud Integration",
    "Pitch: System-Generated Front Matter", "Places to Apply for Jobs",
    "Project: AWS Reserved Instancing", "Project: JA-PARS Report",
    "Project: Job Hunt", "Project: LZC Food Service", "Project: New Job Transition",
    "Project: New Platform Finance Module", "Project: Obsidian Transition",
    "Project: Project Management", "PRs", "Pull Request", "Pull Requests",
    "Qualtrics", "Return of SCORM", "Scrum Notes", "Sector42.net Domain",
    "Slim Update to v4", "Software Demo", "Sprint Planning",
    "System-Generated Front Matter", "Ticket 5940: Change of Address",
    "Prooph Roadmap", "Scrum", "Permissions Model", "Problem Description",
    "Project Code", "ecom-orc", "ecom-services",
    # From substantive/light notes
    "certificate template context model", "Legacy Site: App Server Dist Upgrade",
    "Pitch: Certificates", "Work Phone List",
    "Project: Certificates", "certificate service integration testing POC",
    "Stories to Tell at Scrum", "LexServ",
    # addiction reclassified? No, it stays concept. Let me check...
}
for t in WORK_TITLES:
    ROUTE_OVERRIDE[t] = (["work", "unfiled"], "reference", None)

# Substantive notes → concepts
for t in ["Kink", "compute environment", "Shalamar, the Cat Wizard"]:
    ROUTE_OVERRIDE[t] = (["concepts"], "concept", None)

# --- Find source file for a title ---
def title_to_filename(title):
    """Convert title to possible filenames (colons stripped, brackets stripped)."""
    candidates = [title]
    # Strip colons
    candidates.append(title.replace(":", ""))
    # Strip [[brackets]]
    stripped = re.sub(r'\[\[([^\]]+)\]\]', r'\1', title)
    candidates.append(stripped)
    candidates.append(stripped.replace(":", ""))
    # Deduplicate while preserving order
    seen = set()
    result = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            result.append(c)
    # Also try stripping trailing period (conflicts with .md)
    for c in list(result):
        if c.endswith('.'):
            result.append(c.rstrip('.'))
    # Deduplicate again
    seen2 = set()
    final = []
    for c in result:
        if c not in seen2:
            seen2.add(c)
            final.append(c)
    return final

# Special filename mappings where title != filename
FILENAME_OVERRIDES = {
    "Project: Write an": "Project Write an exocortext think piece",
    "Where Is My Mind?": "Where Is My Mind",
}

def find_source(title):
    """Find the source .md file for a given title."""
    if title in FILENAME_OVERRIDES:
        candidates = [FILENAME_OVERRIDES[title]]
    else:
        candidates = title_to_filename(title)
    for candidate in candidates:
        fname = candidate + ".md"
        p = SOCIAL / fname
        if p.exists():
            return p
        p = ROAM / fname
        if p.exists():
            return p
    return None

def parse_frontmatter(text):
    """Extract YAML frontmatter if present (simple key: value parser)."""
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    result = {}
    for line in text[3:end].strip().splitlines():
        line = line.strip()
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if val:
                result[key] = val
    return result

def get_file_dates(path):
    """Get created/modified dates from file stats."""
    stat = path.stat()
    created = datetime.fromtimestamp(stat.st_birthtime).isoformat()
    updated = datetime.fromtimestamp(stat.st_mtime).isoformat()
    return created, updated

def clean_title(title):
    """Strip [[brackets]] from titles."""
    return re.sub(r'\[\[([^\]]+)\]\]', r'\1', title)

# --- Build manifest ---
manifest = []
seen_titles = set()

# Process all stubs
all_titles = set(stubs)

# Also add titles from other audit lists that aren't in stubs
for title in list(people_map.keys()) + list(music_map.keys()) + list(media_map.keys()) + esoterica + personal:
    all_titles.add(title)

# Add the 7 loose Roam files
for f in ROAM.iterdir():
    if f.is_file() and f.suffix == ".md":
        all_titles.add(f.stem)

for title in sorted(all_titles):
    if title in seen_titles:
        continue
    seen_titles.add(title)

    # Skip discards
    if title in DISCARD:
        continue

    # Find source file
    source = find_source(title)
    if not source:
        continue  # Can't find file, skip

    # Read content
    try:
        text = source.read_text(encoding="utf-8")
    except:
        text = ""

    fm = parse_frontmatter(text)
    created, updated = get_file_dates(source)

    # Use frontmatter dates if available
    if "created" in fm:
        created = str(fm["created"])
    if "updated" in fm:
        updated = str(fm["updated"])

    # Strip frontmatter from content
    content = text
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            content = text[end+3:].strip()

    # Determine if stub (no meaningful content)
    is_stub = not content or not content.strip()

    # For stubs, use single space as content (minimum required by DB)
    if is_stub:
        content = ""

    # Determine destination
    clean = clean_title(title)

    if title in ROUTE_OVERRIDE:
        path, entry_type, subtype = ROUTE_OVERRIDE[title]
    elif title in people_map:
        path = ["data", "people"]
        entry_type = "reference"
        subtype = people_map[title]
    elif title in music_map:
        # Music entries go to /concepts/ per plan
        path = ["concepts"]
        entry_type = "concept"
        subtype = music_map[title]
    elif title in media_map:
        # Media entries go to /concepts/ per plan
        path = ["concepts"]
        entry_type = "concept"
        subtype = media_map[title]
    elif title in esoterica:
        path = ["concepts"]
        entry_type = "concept"
        subtype = None
    elif title in concepts:
        path = ["concepts"]
        entry_type = "concept"
        subtype = None
    elif title in personal:
        # Remaining personal items not overridden → adulting
        path = ["projects", "adulting"]
        entry_type = "reference"
        subtype = None
    else:
        # Default: concepts
        path = ["concepts"]
        entry_type = "concept"
        subtype = None

    # Build vault-relative path for original-source
    rel = str(source.relative_to(VAULT))
    original_source = "/" + rel

    entry = {
        "title": clean,
        "path": path,
        "type": entry_type,
        "content": content,
        "is_stub": is_stub,
        "original-source": original_source,
        "created": created,
        "updated": updated,
        "source_file": str(source),
    }
    if subtype:
        entry["subtype"] = subtype

    # Preserve other frontmatter fields
    extras = {k: v for k, v in fm.items() if k not in ("title", "created", "updated")}
    if extras:
        entry["extra_metadata"] = extras

    manifest.append(entry)

# --- Pass 2: Scan for files not in any audit list ---
# These are substantive/light notes only in reclassifications.md
all_social_files = list(SOCIAL.glob("*.md"))
all_roam_loose = [f for f in ROAM.iterdir() if f.is_file() and f.suffix == ".md"]

for source in all_social_files + all_roam_loose:
    title = source.stem
    if title in seen_titles or clean_title(title) in seen_titles:
        continue
    if title in DISCARD:
        continue

    seen_titles.add(title)

    try:
        text = source.read_text(encoding="utf-8")
    except:
        continue

    fm = parse_frontmatter(text)
    created, updated = get_file_dates(source)
    if "created" in fm:
        created = str(fm["created"])
    if "updated" in fm:
        updated = str(fm["updated"])

    content = text
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            content = text[end+3:].strip()

    is_stub = not content or not content.strip()
    if is_stub:
        content = ""
    clean = clean_title(title)

    # Check overrides: try title, clean title, and re-insert colon variants
    # e.g. filename "UTheia" should match override "U:Theia"
    matched_override = None
    for key in [title, clean]:
        if key in ROUTE_OVERRIDE:
            matched_override = key
            break
    # Try finding override by adding colon back (e.g. "UTheia" → "U:Theia")
    if not matched_override:
        for okey in ROUTE_OVERRIDE:
            if okey.replace(":", "") == title or okey.replace(": ", " ") == title:
                matched_override = okey
                break
    if matched_override:
        path, entry_type, subtype = ROUTE_OVERRIDE[matched_override]
    else:
        # Default unclassified → concepts
        path = ["concepts"]
        entry_type = "concept"
        subtype = None

    rel = str(source.relative_to(VAULT))
    original_source = "/" + rel

    entry = {
        "title": clean,
        "path": path,
        "type": entry_type,
        "content": content,
        "is_stub": is_stub,
        "original-source": original_source,
        "created": created,
        "updated": updated,
        "source_file": str(source),
    }
    if subtype:
        entry["subtype"] = subtype

    extras = {k: v for k, v in fm.items() if k not in ("title", "created", "updated")}
    if extras:
        entry["extra_metadata"] = extras

    manifest.append(entry)

# Group by destination for summary
from collections import Counter
dest_counts = Counter(tuple(e["path"]) for e in manifest)

print(f"Total entries in manifest: {len(manifest)}")
print(f"\nBy destination:")
for dest, count in sorted(dest_counts.items(), key=lambda x: -x[1]):
    print(f"  /{'/'.join(dest)}: {count}")

# Write manifest
with open(AUDIT / "roam-manifest.json", "w") as f:
    json.dump(manifest, f, indent=2, default=str)

print(f"\nManifest written to {AUDIT / 'roam-manifest.json'}")
