---
layout: splash
title: Publications
classes: wide
---
<script type="text/javascript" src="toggle.js"> </script>

# Publications

{% for y in site.data.years %}
## {{ y }}
<div>
{% for x in site.data.pubs.entries reversed %}
  {% assign ystr = y | downcase %}
  {% if x.year == ystr %}
	  <p>
	  	{% for a in x.author %}
	  		{% if forloop.last == true and forloop.first == false %}and{% endif%} {{ a.first }} {{ a.middle }} {{ a.last }}{% if forloop.last == false and forloop.length > 2 %},{% endif %}
	  	{% endfor %}<br>
	    <b>{{ x.title }}</b><br>
	    <em>{{ x.journal }}{{ x.booktitle }} 
	    {{ x.volume }} 
	    ({{ x.year }})</em>.<br>
	    {% if x.url %}
	    	<a href="{{x.url}}">{% if x.url contains "arxiv" %}<span class="arxiv">arXiv</span>{% elsif x.url contains "openreview" %}<span class="openreview">OpenReview</span>{% elsif x.url contains "ssrn" %}<span class="ssrn">SSRN</span>{% elsif x.url contains "dl.acm.org" %}<span class="link">ACM/DL</span>{% elsif x.url contains "ieee" %}<span class="link">IEEE</span>{% elsif x.url contains ".pdf" %}<span class="pdf">PDF</span>{% elsif x.url contains "zenodo" %}<span class="zenodo">zenodo</span>{% else %}<span class="link">Link</span>{% endif %}</a>
	    {% endif %}
	    {% if x.journal and x.volume %}<span class="journal">Journal</span>{% endif %}
	    {% if x.journal and x.journal contains "Findings" %}<span class="conference">Conference</span>{% endif %}
	    {% if x.booktitle %}{% if x.booktitle contains "Workshop" %}<span class="workshop">Workshop</span>{% else%}<span class="conference">Conference</span>{% endif %}{% endif %}
	    {% if x.bibtex %}
	    <a onclick="toggleBibtex('{{ x.id }}');"><span class="bibbutton">bibtex</span></a><br>
	    <div class="bibtex" id="{{ x.id }}" style="display: none;">{{ x.bibtex }}</div>
	    {% endif %}
	  </p>
  {% endif %}
{% endfor %}
</div>
{% endfor %}

