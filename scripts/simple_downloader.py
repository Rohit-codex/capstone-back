#!/usr/bin/env python3
"""
Simple HTTP-based file downloader (no Selenium/webdriver needed).
Uses requests + BeautifulSoup to parse pages and download files directly.

Usage:
    python simple_downloader.py --dry-run              # list all links
    python simple_downloader.py                         # download all files
    python simple_downloader.py --download-dir C:\\tmp # custom download dir
"""
import os
import re
import sys
import logging
import argparse
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

LOG = logging.getLogger("simple_downloader")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# CONFIG
START_URL = "https://aktiwari.com/legal-drafts-legal-formats/"
DOWNLOAD_DIR = str(Path.cwd() / "downloads")
FILE_EXTENSIONS = [".pdf", ".docx", ".doc", ".zip", ".txt", ".rtf"]
CATEGORY_URL_KEY = "-legal-drafts-formats"
REQUEST_TIMEOUT = 30
MAX_WORKERS = 3  # concurrent downloads

# Session with headers to mimic browser
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
})


def ensure_download_dir(path):
    os.makedirs(path, exist_ok=True)


def sanitize_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)


def get_category_folder_name(category_url: str) -> str:
    """Map category URL to a folder name matching server structure."""
    category_map = {
        "adoption-deeds": "Adoption Drafts",
        "affidavit": "Affidavit Formats",
        "arbitration": "Arbitration Agreement",
        "bns": "BNS Drafts",
        "bond": "Bond Drafts",
        "civil-pleadings": "Civil Pleadings Drafts",
        "criminal-pleadings": "Criminal Pleadings Drafts",
        "agreements": "Deeds",
        "appointments": "Deeds",
        "banking": "Deeds",
        "matrimonial": "Family Law Drafts",
        "legal-notice": "Legal Notice",
        "motor-vehicle-act": "MVA Drafts",
        "negotiable-instruments-act": "NI Drafts",
        "power-of-attoney": "Power of Attorney Drafts",
        "special-leave-petition": "SLP Formats",
        "specific-relief-act": "SRA Drafts",
        "rent": "Rent Drafts",
        "misc-pleadings": "Misc Pleadings Drafts",
        "will-gift-deeds": "Will & Gift Deed",
        "writ": "Writ Drafts",
        "rti": "RTI Drafts"
    }
    
    # Extract category slug from URL
    url_lower = category_url.lower()
    for key, folder_name in category_map.items():
        if key in url_lower:
            return folder_name
    
    # Fallback: extract from URL path
    parsed = urllib.parse.urlparse(category_url)
    path_parts = parsed.path.strip('/').split('/')
    if path_parts:
        return path_parts[-1].replace('-legal-drafts-formats', '').replace('-', ' ').title()
    
    return "Other Drafts"


def get_subcategory_folder(filename: str, main_category: str) -> str:
    """Determine subcategory folder based on filename and main category."""
    filename_lower = filename.lower()
    
    # Legal Notice subcategories
    if main_category == "Legal Notice":
        if any(word in filename_lower for word in ['cpc', 'code-of-civil-procedure', 'section-80']):
            return "CPC"
        elif any(word in filename_lower for word in ['mortgage', 'mortgagee', 'mortgagor']):
            return "Mortgage"
        elif any(word in filename_lower for word in ['negotiable', 'cheque', 'dishonour', 'section-138', 'section-93']):
            return "Negotiable Instrument"
        elif any(word in filename_lower for word in ['partnership', 'partner', 'firm', 'section-63']):
            return "Partnership"
        elif any(word in filename_lower for word in ['railway', 'section-78b']):
            return "Railways"
        elif any(word in filename_lower for word in ['tenant', 'lease', 'lessee', 'lessor', 'rent', 'landlord']):
            return "Tenant"
        else:
            return "Miscellaneous"
    
    # Criminal Pleadings Drafts subcategories
    elif main_category == "Criminal Pleadings Drafts":
        if any(word in filename_lower for word in ['bail', 'anticipatory']):
            return "Bail Applications"
        elif any(word in filename_lower for word in ['complaint', 'criminal-complaint']):
            return "Complaints"
        elif any(word in filename_lower for word in ['appeal', 'revision']):
            return "Appeals and Revisions"
        elif any(word in filename_lower for word in ['warrant', 'commitment']):
            return "Warrants"
        elif any(word in filename_lower for word in ['bond', 'bail-bond']):
            return "Bonds"
        elif any(word in filename_lower for word in ['application-under-section', 'application-u-s', 'petition-under-section']):
            return "Applications"
        elif any(word in filename_lower for word in ['summons', 'notice-to']):
            return "Summons and Notices"
        else:
            return "Miscellaneous"
    
    # Power of Attorney Drafts subcategories
    elif main_category == "Power of Attorney Drafts":
        if any(word in filename_lower for word in ['general-power-of-attorney', 'detailed-general']):
            return "General POA"
        elif any(word in filename_lower for word in ['special-power-of-attorney', 'special-power']):
            return "Special POA"
        elif any(word in filename_lower for word in ['court-case', 'vakalatnama', 'advocate', 'legal-proceedings']):
            return "Court Cases"
        elif any(word in filename_lower for word in ['property', 'sale-deed', 'mortgage', 'layout', 'development']):
            return "Property Related"
        elif any(word in filename_lower for word in ['firm', 'company', 'partnership', 'business']):
            return "Business Related"
        elif any(word in filename_lower for word in ['revocation', 'replacement', 'substituted']):
            return "Revocation and Substitution"
        else:
            return "Other POA"
    
    # Will & Gift Deed subcategories
    elif main_category == "Will & Gift Deed":
        if any(word in filename_lower for word in ['gift', 'deed-of-gift', 'memorandum']):
            return "Gift Deeds"
        elif any(word in filename_lower for word in ['will', 'w-i-l-l', 'testator']):
            return "Wills"
        elif any(word in filename_lower for word in ['codicil']):
            return "Codicils"
        elif any(word in filename_lower for word in ['revocation', 'revival']):
            return "Revocation"
        else:
            return "Other"
    
    # Family Law Drafts subcategories
    elif main_category == "Family Law Drafts":
        if any(word in filename_lower for word in ['divorce', 'dissolution', 'section-13']):
            return "Divorce"
        elif any(word in filename_lower for word in ['maintenance', 'alimony', 'section-125']):
            return "Maintenance and Alimony"
        elif any(word in filename_lower for word in ['judicial-separation', 'section-10']):
            return "Judicial Separation"
        elif any(word in filename_lower for word in ['domestic-violence', 'section-232']):
            return "Domestic Violence"
        elif any(word in filename_lower for word in ['nullity', 'section-11', 'section-12']):
            return "Nullity of Marriage"
        elif any(word in filename_lower for word in ['restitution', 'conjugal', 'section-9']):
            return "Restitution of Conjugal Rights"
        elif any(word in filename_lower for word in ['registration', 'marriage-settlement', 'separation-deed']):
            return "Marriage Registration and Settlement"
        else:
            return "Other"
    
    # Affidavit Formats subcategories
    elif main_category == "Affidavit Formats":
        if any(word in filename_lower for word in ['divorce', 'matrimonial', 'marriage']):
            return "Matrimonial"
        elif any(word in filename_lower for word in ['slp', 'supreme-court', 'appeal']):
            return "Supreme Court"
        elif any(word in filename_lower for word in ['writ', 'high-court', 'article-226']):
            return "High Court"
        else:
            return "General"
    
    # Arbitration Agreement subcategories
    elif main_category == "Arbitration Agreement":
        if any(word in filename_lower for word in ['award', 'arbitral-award']):
            return "Awards"
        elif any(word in filename_lower for word in ['agreement', 'supplemental']):
            return "Agreements"
        else:
            return "Other"
    
    # MVA Drafts subcategories
    elif main_category == "MVA Drafts":
        if any(word in filename_lower for word in ['application', 'registration', 'permit', 'grant']):
            return "Applications"
        elif any(word in filename_lower for word in ['suit', 'damages', 'claim']):
            return "Claims and Suits"
        else:
            return "Other"
    
    # NI Drafts subcategories
    elif main_category == "NI Drafts":
        if any(word in filename_lower for word in ['notice', 'notice-under-section-138']):
            return "Notices"
        elif any(word in filename_lower for word in ['complaint', 'section-138']):
            return "Complaints"
        else:
            return "Other"
    
    # Rent Drafts subcategories
    elif main_category == "Rent Drafts":
        if any(word in filename_lower for word in ['suit', 'eviction', 'ejectment']):
            return "Suits"
        elif any(word in filename_lower for word in ['form', 'affidavit']):
            return "Forms"
        else:
            return "Other"
    
    # SRA Drafts subcategories
    elif main_category == "SRA Drafts":
        return "Specific Performance"
    
    # Default: no subcategory
    return None


def get_page_html(url: str) -> str | None:
    """Fetch page HTML."""
    try:
        LOG.info("Fetching %s", url)
        resp = SESSION.get(url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        LOG.exception("Failed to fetch %s: %s", url, e)
        return None


def collect_category_links(start_url: str) -> list[str]:
    """Collect all category page URLs from the main page."""
    html = get_page_html(start_url)
    if not html:
        LOG.warning("Could not fetch main page")
        return []

    soup = BeautifulSoup(html, "html.parser")
    anchors = soup.find_all("a", href=True)
    hrefs = set()

    for a in anchors:
        href = a.get("href", "")
        if href and href.startswith("http") and CATEGORY_URL_KEY in href:
            hrefs.add(href)

    LOG.info("Found %d category links", len(hrefs))
    return sorted(hrefs)


def collect_detail_page_links(url: str) -> list[str]:
    """Collect links to individual draft detail pages from a category page."""
    html = get_page_html(url)
    if not html:
        return []
    
    soup = BeautifulSoup(html, "html.parser")
    detail_links = []
    
    # Find all links that might lead to detail pages
    # Look for links within tables or specific sections
    anchors = soup.find_all("a", href=True)
    for a in anchors:
        href = a.get("href", "")
        if not href:
            continue
        
        # Skip footer, menu, and navigation links
        if any(skip in href.lower() for skip in ['#', 'javascript:', 'mailto:', 'tel:']):
            continue
            
        # Check if this looks like a detail page link (contains parent category in URL)
        parsed = urllib.parse.urlparse(href)
        path = parsed.path or ""
        
        # Skip if it ends with file extension (it's a direct download)
        if any(path.lower().endswith(ext) for ext in FILE_EXTENSIONS):
            continue
            
        # If href contains the category path and is longer (likely a detail page)
        if href.startswith("http") and "legal-drafts-formats" in href and href != url:
            detail_links.append(href)
    
    return list(set(detail_links))


def collect_download_links_on_page(url: str) -> list[str]:
    """Collect all file download links from a category page."""
    html = get_page_html(url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    file_links = []

    # Find all anchors with file extension hrefs
    anchors = soup.find_all("a", href=True)
    for a in anchors:
        href = a.get("href", "")
        if not href:
            continue

        parsed = urllib.parse.urlparse(href)
        path = parsed.path or ""

        # Check if it's a file
        for ext in FILE_EXTENSIONS:
            if path.lower().endswith(ext):
                file_links.append(urllib.parse.urljoin(url, href))
                break

    # Also check for download buttons with onclick or data-url attributes
    buttons = soup.find_all(["button", "a"], class_=lambda x: x and "download" in x.lower() if x else False)
    for btn in buttons:
        # Check onclick attribute
        onclick = btn.get("onclick", "")
        if onclick and "window.location" in onclick:
            # Extract URL from onclick like: window.location='URL'
            match = re.search(r"['\"]([^'\"]+\.(?:docx|pdf|doc|zip|txt|rtf))['\"]", onclick, re.IGNORECASE)
            if match:
                file_url = urllib.parse.urljoin(url, match.group(1))
                if file_url not in file_links:
                    file_links.append(file_url)
        
        # Check data-url or data-file attributes
        data_url = btn.get("data-url") or btn.get("data-file") or btn.get("data-href")
        if data_url:
            file_url = urllib.parse.urljoin(url, data_url)
            if file_url not in file_links:
                file_links.append(file_url)

    # Search for download links in the entire page that might be hidden
    all_links = soup.find_all(["a", "button"], string=re.compile(r"download", re.IGNORECASE))
    for link in all_links:
        href = link.get("href", "")
        if href:
            parsed = urllib.parse.urlparse(href)
            path = parsed.path or ""
            for ext in FILE_EXTENSIONS:
                if path.lower().endswith(ext):
                    full_url = urllib.parse.urljoin(url, href)
                    if full_url not in file_links:
                        file_links.append(full_url)
                    break

    LOG.info("Found %d direct file links on %s", len(file_links), url)
    
    # If we found no files, try looking for detail page links
    if len(file_links) == 0:
        detail_pages = collect_detail_page_links(url)
        LOG.info("Found %d detail pages to check", len(detail_pages))
        for detail_url in detail_pages:
            detail_files = collect_download_links_on_page(detail_url)
            file_links.extend(detail_files)
    
    return file_links


def download_file(url: str, out_dir: str, category_folder: str = None) -> bool:
    """Download a single file via GET request."""
    try:
        parsed = urllib.parse.urlparse(url)
        filename = os.path.basename(parsed.path) or "download"
        filename = sanitize_filename(filename)
        
        # Create category subfolder if specified
        if category_folder:
            # Determine subcategory based on filename
            subcategory = get_subcategory_folder(filename, category_folder)
            if subcategory:
                target_dir = os.path.join(out_dir, category_folder, subcategory)
            else:
                target_dir = os.path.join(out_dir, category_folder)
            os.makedirs(target_dir, exist_ok=True)
        else:
            target_dir = out_dir
        
        outpath = os.path.join(target_dir, filename)

        # Skip if already exists
        if os.path.exists(outpath):
            LOG.info("Already exists: %s", outpath)
            return True

        LOG.info("Downloading %s -> %s", url, outpath)
        resp = SESSION.get(url, stream=True, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()

        with open(outpath, "wb") as f:
            for chunk in resp.iter_content(8192):
                if chunk:
                    f.write(chunk)

        LOG.info("Downloaded %s", filename)
        return True

    except Exception as e:
        LOG.exception("Failed to download %s: %s", url, e)
        return False


def download_all(file_links_by_category: dict[str, list[str]], out_dir: str, max_workers: int = MAX_WORKERS) -> int:
    """Download multiple files concurrently, organized by category."""
    ensure_download_dir(out_dir)
    downloaded = 0
    futures = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for category_folder, links in file_links_by_category.items():
            for link in links:
                futures.append(executor.submit(download_file, link, out_dir, category_folder))

        for fut in as_completed(futures):
            if fut.result():
                downloaded += 1

    return downloaded


def main():
    parser = argparse.ArgumentParser(description="Download files from site categories (no browser needed)")
    parser.add_argument("--dry-run", action="store_true", help="Only list links; do not download")
    parser.add_argument("--start-url", type=str, default=START_URL, help="Override start URL")
    parser.add_argument("--download-dir", type=str, default=DOWNLOAD_DIR, help="Download directory")
    parser.add_argument("--max-workers", type=int, default=MAX_WORKERS, help="Concurrent downloads")
    args = parser.parse_args()

    if not args.dry_run:
        ensure_download_dir(args.download_dir)

    # Collect category links
    category_links = collect_category_links(args.start_url)
    if not category_links:
        LOG.warning("No category links found using key '%s' — will try main URL as category", CATEGORY_URL_KEY)
        category_links = [args.start_url]

    file_links_by_category = {}
    total_files = 0

    # Collect file links from each category
    for cat in category_links:
        LOG.info("Processing category: %s", cat)
        file_links = collect_download_links_on_page(cat)
        
        if file_links:
            category_folder = get_category_folder_name(cat)
            file_links_by_category[category_folder] = file_links
            total_files += len(file_links)
            
            if args.dry_run:
                LOG.info("  Category: %s (%d files)", category_folder, len(file_links))
                for link in file_links:
                    LOG.info("    %s", link)

    LOG.info("Total file links collected: %d across %d categories", total_files, len(file_links_by_category))

    if args.dry_run:
        LOG.info("Dry run complete — no files downloaded")
        LOG.info("\nHierarchical folder structure that will be created:")
        
        for folder in sorted(file_links_by_category.keys()):
            LOG.info("  %s/ (%d files)", folder, len(file_links_by_category[folder]))
            
            # Group files by subcategory
            subcategory_files = {}
            for link in file_links_by_category[folder]:
                parsed = urllib.parse.urlparse(link)
                filename = os.path.basename(parsed.path)
                subcategory = get_subcategory_folder(filename, folder)
                
                if subcategory:
                    if subcategory not in subcategory_files:
                        subcategory_files[subcategory] = []
                    subcategory_files[subcategory].append(filename)
                else:
                    if "Root" not in subcategory_files:
                        subcategory_files["Root"] = []
                    subcategory_files["Root"].append(filename)
            
            # Display subcategories
            for subcat in sorted(subcategory_files.keys()):
                if subcat == "Root":
                    LOG.info("    └── (root): %d files", len(subcategory_files[subcat]))
                else:
                    LOG.info("    └── %s/: %d files", subcat, len(subcategory_files[subcat]))
        
        return

    if not file_links_by_category:
        LOG.warning("No file links found to download")
        return

    # Download all files
    downloaded = download_all(file_links_by_category, args.download_dir, max_workers=args.max_workers)
    LOG.info("Downloaded %d files to %s", downloaded, args.download_dir)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        LOG.info("Interrupted by user")
        sys.exit(0)
