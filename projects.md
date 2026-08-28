---
layout: splash
title: Projects
classes: wide
toc: true

---

<script type="text/javascript" src="toggle.js"></script>
{% for proj in site.data.projects %}| <a href="#{{ proj.name | downcase | replace: ' ', '-' }}">{{ proj.name }}</a> {% endfor %} |

{% for proj in site.data.projects %}

## {{ proj.name }}

{{ proj.description }}

{% if proj.pubs %}
**Representative Publications:**
<ul>
	{% for p in proj.pubs %}
		{% assign x = site.data.pubs.entries | where:"id", p.id | first %}
		<li>
		{% if p.context %}
			<span class="context">{{ p.context}}</span><br>
		{% endif %}
		{% for a in x.author %}
	  		{% if forloop.last == true and forloop.first == false %}and{% endif%} {{ a.first }} {{ a.middle }} {{ a.last }}{% if forloop.last == false and forloop.length > 2 %},{% endif %}
	  	{% endfor %}<br>
	    <b>{{ x.title }}</b><br>
	    <em>{{ x.journal }}{{ x.booktitle }} 
	    {{ x.volume }} 
	    ({{ x.year }})</em>.<br>
	    {% if x.url %}
	    	<a href="{{x.url}}">{% if x.url contains "arxiv" %}<span class="arxiv">arXiv</span>{% elsif x.url contains "openreview" %}<span class="openreview">OpenReview</span>{% elsif x.url contains "dl.acm.org" %}<span class="link">ACM/DL</span>{% elsif x.url contains "ieee" %}<span class="link">IEEE</span>{% elsif x.url contains ".pdf" %}<span class="pdf">PDF</span>{% else %}<span class="link">Link</span>{% endif %}</a>
	    {% endif %}
	    {% if x.journal and x.volume %}<span class="journal">Journal</span>{% endif %}
	    {% if x.booktitle %}{% if x.booktitle contains "Workshop" %}<span class="workshop">Workshop</span>{% else%}<span class="conference">Conference</span>{% endif %}{% endif %}
	    {% if x.bibtex %}
	    <a onclick="toggleBibtex('{{ x.id }}');"><span class="bibbutton">bibtex</span></a><br>
	    <div class="bibtex" id="{{ x.id }}" style="display: none;">{{ x.bibtex }}</div>
	    {% endif %}
	  </li>
	{% endfor %}
</ul>
{% endif %}

{% endfor %}
