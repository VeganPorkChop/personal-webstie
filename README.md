# Personal Website

## GitHub Pages setup

This repo is structured for GitHub Pages to publish the `docs/` folder.

1. Go to **Settings → Pages** in your GitHub repository.
2. Under **Build and deployment**, select:
   - **Source:** Deploy from a branch
   - **Branch:** `main`
   - **Folder:** `/docs`
3. Save and wait for GitHub Pages to publish.

### Notes
- The site entry point is `docs/index.html`.
- Image URLs are configured in `docs/site-images.css`. This file is set up to use externally hosted images instead of binary files in the repo.

## Hosting images externally

If your workflow blocks binary files, upload the images to a static host (GitHub Releases, Cloudinary, S3, etc.) and paste the URLs into `docs/site-images.css`.

## Local preview

You can open `docs/index.html` directly in a browser, or serve the folder with any static file server.
