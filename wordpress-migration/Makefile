PYTHON ?= python
SOURCE_ROOT ?= ..
WP_URL ?= $(shell awk -F= '/^WP_URL=/{print $$2}' .env 2>/dev/null)
ONLY_SLUGS ?=

.PHONY: audit discover build wxr test preview apply verify clean browser-discover

audit:
	$(PYTHON) scripts/audit_source.py --source-root $(SOURCE_ROOT)

discover:
	$(PYTHON) scripts/discover_wordpress.py --url "$(WP_URL)"

build:
	$(PYTHON) scripts/run_pipeline.py --source-root $(SOURCE_ROOT)

wxr: build
	@echo "Generated build/hcai-lab.wordpress.xml (do not import again on the live site)"

test:
	pytest -q

preview:
	cd browser && node preview-pages.mjs

apply:
	cd browser && npm install && npx playwright install chromium && ONLY_SLUGS="$(ONLY_SLUGS)" WP_URL="$(WP_URL)" npm run apply

verify:
	$(PYTHON) scripts/verify_site.py --url "$(WP_URL)"

browser-discover:
	cd browser && npm install && npx playwright install chromium && WP_URL="$(WP_URL)" npm run discover

clean:
	find build -mindepth 1 ! -name .gitkeep -delete
