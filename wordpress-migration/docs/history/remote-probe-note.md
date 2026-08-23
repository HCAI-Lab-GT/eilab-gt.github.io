# Remote Probe Note

The staging URL is valid input supplied by the site administrator:

`https://sites.gatech.edu/hcailab/`

The ChatGPT execution environment used to assemble this kit could not complete a direct live fetch of Sites@GeorgiaTech: its web fetch backend returned a gateway error and its sandbox had no external DNS resolution. This is an environment limitation, not evidence that the WordPress site or REST API is unavailable.

The kit therefore performs the authoritative capability check on the user's machine through:

```bash
python scripts/discover_wordpress.py
```

and, if necessary:

```bash
make browser-discover
```

Do not infer REST, theme, importer, or Application Password availability until one of those local discovery paths runs.
