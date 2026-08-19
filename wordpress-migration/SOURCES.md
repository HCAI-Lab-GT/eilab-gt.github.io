# Authoritative Platform Sources

These sources establish the platform assumptions used by the migration kit. They are reference material; the capability-discovery scripts still inspect the actual target site because CampusPress network settings can vary.

## Georgia Tech

### Sites@GeorgiaTech overview

https://sites.gatech.edu/

Establishes that Sites@GeorgiaTech is Georgia Tech's WordPress service, jointly managed by CampusPress and GT OIT, and is intended for research, projects, and organizational sites.

### Georgia Tech website brand requirements

https://brand.gatech.edu/our-look/websites

Establishes that Georgia Tech-managed websites are expected to align with Institute brand standards and that a WordPress version of the official theme is available through Sites@GeorgiaTech.

### Website theme/header/footer guidance

https://brand.gatech.edu/our-look/websites/header

Establishes that the official Georgia Tech logo belongs in the gold brand bar and that unit/lab identification belongs in the website title and optional slogan.

### Website assets and WordPress theme

https://brand.gatech.edu/brand-assets/website

Points Sites@GeorgiaTech/CampusPress users to the official Georgia Tech WordPress theme.

### Sites@GeorgiaTech custom domains

https://sites.gatech.edu/custom-domain-names/

Establishes that a Sites@GT site must exist before the custom-domain request, that vanity aliases require approval, that unit subdomains are preferred for labs, and that one custom domain is supported per site.

### Georgia Tech vanity alias criteria

https://brand.gatech.edu/our-look/websites/domain-name-criteria

Establishes the current distinction between first-level Institute aliases and college/school/department subdomains used for individual labs.

## CampusPress

### Application Password network control

https://campuspress.com/docs/security-headers-robots-txt-and-advanced-network-setting/

Establishes that CampusPress network administrators can disable WordPress Application Passwords globally, which is why the kit discovers rather than assumes the feature.

### Advanced WordPress Importer

https://campuspress.com/advanced-wordpress-importer-plugin/

Establishes that CampusPress provides an enhanced WordPress importer and that it may be restricted to super administrators unless the network enables it for all users.

### CampusPress accessibility responsibility

https://campuspress.com/docs/accessibility/

Establishes that the hosting/theme foundation can support accessibility, but site owners remain responsible for the accessibility of migrated content, documents, media, and custom HTML.

## WordPress

### REST API reference and discovery

https://developer.wordpress.org/rest-api/reference/

Establishes that WordPress REST APIs are site-specific, self-describing, and expose pages, media, settings, themes, and other resources through discoverable routes.

### Pages REST endpoint

https://developer.wordpress.org/rest-api/reference/pages/

Documents listing, creating, and updating pages, including slug, status, title, content, menu order, and other fields used by `sync_wordpress.py`.

### Settings REST endpoint

https://developer.wordpress.org/rest-api/reference/settings/

Documents site title, tagline, timezone, static-front-page settings, and the authenticated update endpoint used by `sync_wordpress.py`.

### WordPress Tools → Import

https://wordpress.org/documentation/article/tools-import-screen/

Documents importing pages and other content from a WordPress export/WXR file.
