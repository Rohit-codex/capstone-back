#!/usr/bin/env python3
"""
RTF to DOCX Bulk Conversion Script

Converts all RTF files in normalized_templates to DOCX format
while preserving folder structure, formatting, and metadata.

Usage:
    python convert_rtf_to_docx.py --dry-run  # Preview changes
    python convert_rtf_to_docx.py            # Execute conversion
    python convert_rtf_to_docx.py --backup-dir custom_backup  # Custom backup location
"""

import os
import sys
import shutil
import subprocess
import argparse
from pathlib import Path
from datetime import datetime
import json

# Try importing pypandoc, fallback to subprocess with LibreOffice
try:
    import pypandoc
    CONVERSION_METHOD = 'pypandoc'
except ImportError:
    CONVERSION_METHOD = 'libreoffice'
    print("⚠️  pypandoc not found, will use LibreOffice headless mode")
    print("   Install LibreOffice if not available: https://www.libreoffice.org/")

class RTFConverter:
    def __init__(self, templates_dir, backup_dir=None, dry_run=False):
        self.templates_dir = Path(templates_dir)
        self.backup_dir = Path(backup_dir) if backup_dir else self.templates_dir.parent / f"_rtf_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.dry_run = dry_run
        self.stats = {
            'total_rtf': 0,
            'converted': 0,
            'failed': 0,
            'skipped': 0,
            'errors': []
        }
    
    def find_all_rtf_files(self):
        """Recursively find all RTF files in templates directory."""
        rtf_files = []
        for root, dirs, files in os.walk(self.templates_dir):
            for file in files:
                if file.lower().endswith('.rtf'):
                    rtf_files.append(Path(root) / file)
        return rtf_files
    
    def convert_with_pypandoc(self, rtf_path, docx_path):
        """Convert RTF to DOCX using pypandoc."""
        try:
            pypandoc.convert_file(
                str(rtf_path),
                'docx',
                format='rtf',
                outputfile=str(docx_path),
                extra_args=['--reference-doc=reference.docx'] if Path('reference.docx').exists() else []
            )
            return True, None
        except Exception as e:
            return False, str(e)
    
    def convert_with_libreoffice(self, rtf_path, docx_path):
        """Convert RTF to DOCX using LibreOffice headless."""
        try:
            # LibreOffice command for headless conversion
            output_dir = docx_path.parent
            cmd = [
                'soffice',  # or 'libreoffice' on some systems
                '--headless',
                '--convert-to', 'docx',
                '--outdir', str(output_dir),
                str(rtf_path)
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                # LibreOffice creates file with same name, need to verify
                expected_output = output_dir / f"{rtf_path.stem}.docx"
                if expected_output.exists():
                    if expected_output != docx_path:
                        shutil.move(str(expected_output), str(docx_path))
                    return True, None
                else:
                    return False, f"Output file not created: {expected_output}"
            else:
                return False, result.stderr
                
        except subprocess.TimeoutExpired:
            return False, "Conversion timeout (30s)"
        except FileNotFoundError:
            return False, "LibreOffice not found. Install it or use pypandoc."
        except Exception as e:
            return False, str(e)
    
    def backup_rtf_file(self, rtf_path):
        """Backup RTF file to backup directory maintaining folder structure."""
        relative_path = rtf_path.relative_to(self.templates_dir)
        backup_path = self.backup_dir / relative_path
        
        if not self.dry_run:
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(rtf_path, backup_path)
        
        return backup_path
    
    def update_json_reference(self, json_path, old_filename, new_filename):
        """Update JSON metadata to reference new DOCX filename."""
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if data.get('filename') == old_filename:
                data['filename'] = new_filename
                
                if not self.dry_run:
                    with open(json_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                
                return True
            return False
            
        except Exception as e:
            print(f"   ⚠️  Failed to update JSON {json_path.name}: {e}")
            return False
    
    def convert_file(self, rtf_path):
        """Convert single RTF file to DOCX."""
        self.stats['total_rtf'] += 1
        
        # Generate DOCX path
        docx_path = rtf_path.with_suffix('.docx')
        
        # Check if DOCX already exists
        if docx_path.exists():
            print(f"⏭️  Skipped (DOCX exists): {rtf_path.name}")
            self.stats['skipped'] += 1
            return
        
        print(f"🔄 Converting: {rtf_path.relative_to(self.templates_dir)}")
        
        if self.dry_run:
            print(f"   [DRY RUN] Would convert to: {docx_path.name}")
            self.stats['converted'] += 1
            return
        
        # Backup original RTF
        backup_path = self.backup_rtf_file(rtf_path)
        print(f"   💾 Backed up to: {backup_path.relative_to(self.backup_dir)}")
        
        # Perform conversion
        if CONVERSION_METHOD == 'pypandoc':
            success, error = self.convert_with_pypandoc(rtf_path, docx_path)
        else:
            success, error = self.convert_with_libreoffice(rtf_path, docx_path)
        
        if success:
            print(f"   ✅ Created: {docx_path.name}")
            
            # Update corresponding JSON file
            json_path = rtf_path.with_suffix('.json')
            if json_path.exists():
                if self.update_json_reference(json_path, rtf_path.name, docx_path.name):
                    print(f"   📝 Updated JSON reference")
            
            # Remove original RTF file (it's backed up)
            rtf_path.unlink()
            print(f"   🗑️  Removed original RTF")
            
            self.stats['converted'] += 1
        else:
            print(f"   ❌ Conversion failed: {error}")
            self.stats['failed'] += 1
            self.stats['errors'].append({
                'file': str(rtf_path.relative_to(self.templates_dir)),
                'error': error
            })
    
    def run(self):
        """Run the conversion process."""
        print("=" * 80)
        print("RTF to DOCX Bulk Conversion")
        print("=" * 80)
        print(f"Templates directory: {self.templates_dir}")
        print(f"Backup directory: {self.backup_dir}")
        print(f"Conversion method: {CONVERSION_METHOD}")
        print(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        print("=" * 80)
        print()
        
        # Find all RTF files
        print("🔍 Scanning for RTF files...")
        rtf_files = self.find_all_rtf_files()
        print(f"   Found {len(rtf_files)} RTF files\n")
        
        if not rtf_files:
            print("✅ No RTF files found. All templates already in DOCX format.")
            return
        
        if self.dry_run:
            print("⚠️  DRY RUN MODE - No files will be modified\n")
        else:
            # Create backup directory
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            print(f"📁 Created backup directory: {self.backup_dir}\n")
        
        # Convert each file
        for i, rtf_path in enumerate(rtf_files, 1):
            print(f"\n[{i}/{len(rtf_files)}]")
            self.convert_file(rtf_path)
        
        # Print summary
        print("\n" + "=" * 80)
        print("Conversion Summary")
        print("=" * 80)
        print(f"Total RTF files: {self.stats['total_rtf']}")
        print(f"✅ Converted: {self.stats['converted']}")
        print(f"⏭️  Skipped (already DOCX): {self.stats['skipped']}")
        print(f"❌ Failed: {self.stats['failed']}")
        
        if self.stats['errors']:
            print(f"\n❌ Errors ({len(self.stats['errors'])}):")
            for error in self.stats['errors'][:10]:  # Show first 10 errors
                print(f"   • {error['file']}")
                print(f"     {error['error']}")
            if len(self.stats['errors']) > 10:
                print(f"   ... and {len(self.stats['errors']) - 10} more errors")
        
        print("=" * 80)
        
        if not self.dry_run and self.stats['converted'] > 0:
            print(f"\n💾 Original RTF files backed up to: {self.backup_dir}")
            print(f"   You can delete this folder after verifying conversions.")

def main():
    parser = argparse.ArgumentParser(
        description='Convert all RTF templates to DOCX format',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python convert_rtf_to_docx.py --dry-run          Preview what will be converted
  python convert_rtf_to_docx.py                     Execute conversion
  python convert_rtf_to_docx.py --backup custom    Use custom backup folder
        """
    )
    
    parser.add_argument(
        '--templates-dir',
        default='../server/normalized_templates',
        help='Path to normalized_templates directory (default: ../server/normalized_templates)'
    )
    
    parser.add_argument(
        '--backup-dir',
        help='Custom backup directory path (default: auto-generated with timestamp)'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without modifying files'
    )
    
    args = parser.parse_args()
    
    # Resolve templates directory
    script_dir = Path(__file__).parent
    templates_dir = (script_dir / args.templates_dir).resolve()
    
    if not templates_dir.exists():
        print(f"❌ Error: Templates directory not found: {templates_dir}")
        sys.exit(1)
    
    # Run conversion
    converter = RTFConverter(
        templates_dir=templates_dir,
        backup_dir=args.backup_dir,
        dry_run=args.dry_run
    )
    
    try:
        converter.run()
        
        if converter.stats['failed'] > 0:
            sys.exit(1)
        else:
            sys.exit(0)
            
    except KeyboardInterrupt:
        print("\n\n⚠️  Conversion interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
