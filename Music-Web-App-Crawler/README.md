# Blade Music

A terminal-based playwright app that allows you to batch download music from https://dabmusic.xyz/

## Features

- Download tracks in batches, with a provided list of comma-separated songs
- Download albums in batches, with a provided list of comma-separated albums

## Tech Stack

**Scraping**: playwright, JavaScript, Node.js

## Pre-requisites
**Node.js Runtime**: https://nodejs.org/en

## Run Locally

Clone the project

```bash
  git clone https://github.com/VanitasBlade/Music-Web-App-Crawler.git
```

Go to the project directory

```bash
  cd Music-Web-App-Crawler
```

Install dependencies

```bash
  npm install
```

Install a browser
```bash
  # Blade Music

  A small Node.js command-line utility for searching and downloading songs.

  This repository contains a lightweight downloader that uses the scripts in `src/` to search for tracks and save them to the `songs/` folder.

  **Table of Contents**
  - Installation
  - Quick Start
  - Configuration
  - Project Structure
  - Development
  - Contributing


  ## Installation

  1. Install Node.js (recommended: Node 16+).
  2. Install dependencies:

  ```bash
  npm install
  ```

  ## Quick Start

  1. Configure options in `src/config.js` if necessary (paths, API keys, or other options).
  2. Run the app:

  ```bash
  node src/index.js
  ```

  Downloaded files will be placed in the `songs/` directory by default.

  ## Configuration

  Edit `src/config.js` to change runtime options such as the download directory, concurrency, or provider settings. See the file for the available configuration options and inline comments.

  Configuration file: [src/config.js](src/config.js)

  ## Project Structure

  - `src/index.js` — CLI entrypoint / orchestration
  - `src/search.js` — search utilities and query handling
  - `src/downloader.js` — download worker and stream handling
  - `src/browser.js` — browser automation / scraping helpers
  - `src/logger.js` — logging wrapper used across modules(No logger activity currently)
  - `src/config.js` — runtime configuration
  - `songs/` — default output directory for downloaded tracks

  Use these files as the main integration points when you extend or debug the app.

  ## Development

  - To run the project locally: `node src/index.js`.
  - When modifying behavior, add small, testable changes and run the app to verify downloads and logs.
  - Keep the `songs/` folder separate from source code and back it up if it contains important files.

  ## Contributing

  Issues and pull requests are welcome. Create a clear issue describing the bug or feature, and open a PR with a short summary of the change and any required setup.
