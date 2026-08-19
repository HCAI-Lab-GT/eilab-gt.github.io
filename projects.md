---
layout: splash
title: Projects
classes: wide
toc: true

---

<script type="text/javascript" src="toggle.js"></script>

<style type="text/css">
a:link, a:visited, a:hover, a:active {text-decoration: none;}
.arxiv {
	font-size: small;
	background-color: red;
	color: white;
	border: 1px solid red;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.openreview {
	font-size: small;
	background-color: red;
	color: white;
	border: 1px solid red;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.pdf {
	font-size: small;
	background-color: blue;
	color: white;
	border: 1px solid blue;
	text-decoration: none;
	text-decoration-color: black;
	border-radius: 2px;
}
.link {
	font-size: small;
	background-color: blue;
	color: white;
	border: 1px solid blue;
	text-decoration: none;
	text-decoration-color: black;
	border-radius: 2px;
}
.journal {
	font-size: small;
	background-color: green;
	color: white;
	border: 1px solid green;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.conference {
	font-size: small;
	background-color: orange;
	color: white;
	border: 1px solid orange;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.workshop {
	font-size: small;
	background-color: purple;
	color: white;
	border: 1px solid purple;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.bibbutton {
	font-size: small;
	background-color: black;
	color: white;
	border: 1px solid black;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.bibtex {
	white-space: pre-wrap;
	font-size: small;
	font-family: Courier;
	background: #eeeeee;
	border: 1px dotted black;
	width: 75%;
}	
.context {
	font-style: italic;
	color: gray;
}
</style>
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
