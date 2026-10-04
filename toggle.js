// Show or hide a publication's BibTeX block and keep its button's state in sync.
function toggleBibtex(id) {
	var block = document.getElementById(id);
	var open = block.hidden;
	block.hidden = !open;
	var button = document.querySelector('[aria-controls="' + id + '"]');
	if (button) button.setAttribute('aria-expanded', open);
}
