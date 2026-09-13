from pybtex.database import parse_file
import sys
import codecs


bib_data = parse_file(sys.argv[1])

# Normalise field and person-role names to lowercase before writing the YAML.
# lab.bib mixes two styles -- `title = {...}` and the older `Title = {...}` --
# and pybtex preserves whichever case it finds. The Jekyll templates only look
# for lowercase keys (x.year, x.title, x.author), so entries written in the
# capitalised style came through with no usable fields and silently dropped out
# of the publications page.
for entry in bib_data.entries.values():
    fields = list(entry.fields.items())
    entry.fields.clear()
    for name, value in fields:
        entry.fields[name.lower()] = value

    persons = list(entry.persons.items())
    entry.persons.clear()
    for role, people in persons:
        entry.persons[role.lower()] = people

bib_data.to_file(sys.argv[2], "yaml")
