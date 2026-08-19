PYTHON ?= python
SOURCE_ROOT ?= ..
WP_URL ?= $(shell awk -F= '/^WP_URL=/{print $$2}' .env 2>/dev/null)

.PHONY: audit discover build wxr test sync-dry verify clean browser-discover

audit:
	$(PYTHON) scripts/audit_source.py --source-root $(SOURCE_ROOT)

discover:
	$(PYTHON) scripts/discover_wordpress.py --url "$(WP_URL)"

build:
	$(PYTHON) scripts/run_pipeline.py --source-root $(SOURCE_ROOT)

wxr: build
	@echo "Generated build/hcai-lab.wordpress.xml"

test:
	pytest -q

sync-dry: build
	$(PYTHON) scripts/sync_wordpress.py --source-root $(SOURCE_ROOT) --dry-run

verify:
	$(PYTHON) scripts/verify_site.py --url "$(WP_URL)"

browser-discover:
	cd browser && npm install && npx playwright install chromium && WP_URL="$(WP_URL)" npm run discover

clean:
	find build -mindepth 1 ! -name .gitkeep -delete
