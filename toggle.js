function toggleBibtex(id) {
	console.log(id);
	element = document.getElementById(id)
	console.log(element);
	if (element.style.display == "none") {
		element.style.display="block";
	}
	else {
		element.style.display="none";
	}
}
