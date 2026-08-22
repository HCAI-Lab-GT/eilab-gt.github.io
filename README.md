# eilab-gt.github.io
Entertainment Intelligence and Human-Centered AI Labs

**To update publications:**

1. Edit bibs/lab.bib
2. run `./bib2yml.sh lab.bib pubs.yml`
3. Move pubs.yml to the `_data` directory
4. Git commit changes. Github pages should take care of the rest.

**To update lab members:**

1. Edit phds.yml, masters.yml, undergrads.yml, faculty.yml, or alumni.yml in the `_data` directory.
2. Optional headshot: add the image to `assets/images/members/` and set `photo: /assets/images/members/<file>.jpg` on that member's entry. Square images around 400x400 look best; members without a photo get a monogram disc.

**To update the Capabilibara project page:**

1. Copy the built site from the `capabilibara` repo `public/` directory into `capabilibara/` here.
2. Confirm `capabilibara/index.html` canonical and Open Graph URLs use `https://eilab.gatech.edu/capabilibara/`.
3. Do not add YAML front matter to files under `capabilibara/`. Jekyll copies them as static files.
4. Git commit. GitHub Pages publishes to https://eilab.gatech.edu/capabilibara/.


