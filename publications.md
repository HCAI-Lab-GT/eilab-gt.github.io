---
layout: splash
title: Publications
classes: wide
---
<script type="text/javascript" src="toggle.js"> </script>

<style type="text/css" src="bibs.css">
a:link, a:visited, a:hover, a:active {text-decoration: none;}
.arxiv {
	font-size: small;
	background-color: #000000;
	color: white;
	border: 1px solid #000000;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.zenodo {
	font-size: small;
	background-color: #1D49A4;
	color: white;
	border: 1px solid #1D49A4;
	text-decoration: none;
	text-decoration-color: white;
	border-radius: 2px;
}
.ssrn {
	font-size: small;
	background-color: #18386F;
	color: white;
	border: 1px solid #18386F;
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
	background-color: white;
	color: black;
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
</style>

# Publications

{% for y in site.data.years %}
## {{ y }}
<p>
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
	    <a onclick="toggleBibtex({{ x.id }});"><span class="bibbutton">bibtex</span></a><br>
	    <div class="bibtex" id="{{ x.id }}" style="display: none;">{{ x.bibtex }}</div>
	    {% endif %}
	  </p>
  {% endif %}
{% endfor %}
</p>
{% endfor %}

