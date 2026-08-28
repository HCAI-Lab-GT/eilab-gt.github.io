---
layout: splash
title: Theses
classes: wide

---

# Theses

{% for thesis in site.data.theses reversed %}
<article class="thesis-card">
  <h2 class="thesis-title"><a href="{{ thesis.url }}">{{ thesis.title }}</a></h2>
  <p class="thesis-meta">{{ thesis.name }} &middot; Ph.D. Dissertation, {{ thesis.institute }}, {{ thesis.year }}</p>
  {% if thesis.abstract %}
  <details class="thesis-abstract">
    <summary>Abstract</summary>
    <p>{{ thesis.abstract }}</p>
  </details>
  {% endif %}
</article>
{% endfor %}
