---
layout: splash
title: Members

---

# Members

{% include member-list.html title="Faculty" members=site.data.faculty.members %}

{% include member-list.html title="PhD Students" members=site.data.phds.members %}

{% include member-list.html title="Masters Students" members=site.data.masters.members %}

{% include member-list.html title="Undergraduate Students" members=site.data.undergrads.members %}

{% include member-list.html title="Alumni" members=site.data.alumni.members show_where=true %}

{% include member-list.html title="Affiliated" members=site.data.affiliated.members %}
