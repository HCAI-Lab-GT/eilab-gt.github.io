---
layout: splash
title: Members

---

# Members

**Faculty**

<ul>
{% for x in site.data.faculty.members %}
  <li>
    {% if x.website %}<a href="{{ x.website }}">{{ x.name }}</a>{% else %}{{ x.name }}{% endif %}
  </li>
{% endfor %}
</ul>

**PhD Students**

<ul>
{% for x in site.data.phds.members %}
  <li>
    {% if x.website %}<a href="{{ x.website }}">{{ x.name }}</a>{% else %}{{ x.name }}{% endif %}
  </li>
{% endfor %}
</ul>

**Masters Students**

<ul>
{% for x in site.data.masters.members %}
  <li>
    {% if x.website %}<a href="{{ x.website }}">{{ x.name }}</a>{% else %}{{ x.name }}{% endif %}
  </li>
{% endfor %}
</ul>

**Undergraduate Students**

<ul>
{% for x in site.data.undergrads.members %}
  <li>
    {% if x.website %}<a href="{{ x.website }}">{{ x.name }}</a>{% else %}{{ x.name }}{% endif %}
  </li>
{% endfor %}
</ul>

**Alumni**

<ul>
{% for x in site.data.alumni.members %}
  <li>
    {% if x.website %}<a href="{{ x.website }}">{{ x.name }}</a>{% else %}{{ x.name }}{% endif %}: {{ x.where }}
  </li>
{% endfor %}
</ul>

**Affiliated**

<ul>
{% for x in site.data.affiliated.members %}
  <li>
    {% if x.website %}<a href="{{ x.website }}">{{ x.name }}</a>{% else %}{{ x.name }}{% endif %}
  </li>
{% endfor %}
</ul>
