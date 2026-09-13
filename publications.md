---
layout: splash
title: Publications
classes: wide
---
<script type="text/javascript" src="{{ '/toggle.js' | relative_url }}"> </script>

# Publications

{% include keyword-chips.html %}

{% include publication-list.html %}

<script>
// Legacy support for /publications.html?keyword=xai -- send it to the real page.
(function () {
  var k = new URLSearchParams(window.location.search).get('keyword');
  if (!k) return;
  var known = [{% for k2 in site.data.keywords %}'{{ k2.tag }}'{% unless forloop.last %},{% endunless %}{% endfor %}];
  if (known.indexOf(k) !== -1) {
    window.location.replace('{{ "/publications/" | relative_url }}' + k + '/');
  }
})();
</script>
