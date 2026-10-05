import sys
import os
import json
import zipfile
import tempfile
import requests
import time
from sarvamai import SarvamAI

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
        
    file_path = sys.argv[1]
    
    if not os.path.exists(file_path):
        print(json.dumps({"error": "File does not exist"}))
        sys.exit(1)

    api_key = os.environ.get("sarvamai")
    if not api_key:
        print(json.dumps({"error": "No Sarvam API key found in environment"}))
        sys.exit(1)

    try:
        # Initialize client
        client = SarvamAI(api_subscription_key=api_key)
        
        # Determine language
        # Create Job
        job_res = client.document_intelligence.initialise(job_parameters={"language": "en-IN", "output_format": "md"})
        job_id = job_res.job_id
        
        # Get upload link
        filename = os.path.basename(file_path)
        upload_links_res = client.document_intelligence.get_upload_links(job_id=job_id, files=[filename])
        upload_url_info = upload_links_res.upload_urls[filename]
        upload_url = upload_url_info.file_url

        # Upload
        with open(file_path, 'rb') as f:
            # For Azure blob
            res = requests.put(upload_url, data=f, headers={'x-ms-blob-type': 'BlockBlob'})
            res.raise_for_status()

        # Start Job
        client.document_intelligence.start(job_id=job_id)
        
        # Poll Status
        while True:
            status_res = client.document_intelligence.get_status(job_id=job_id)
            if status_res.job_state in ["Completed", "Failed"]:
                if status_res.job_state == "Failed":
                    print(json.dumps({"error": "Sarvam API returned Failed state"}))
                    sys.exit(1)
                break
            time.sleep(3)
        
        # Download output
        download_links_res = client.document_intelligence.get_download_links(job_id=job_id)
        download_url = list(download_links_res.download_urls.values())[0].file_url
        
        # Get the ZIP
        zip_res = requests.get(download_url)
        zip_res.raise_for_status()
        
        with tempfile.TemporaryDirectory() as tmpdirname:
            zip_path = os.path.join(tmpdirname, "output.zip")
            with open(zip_path, 'wb') as f:
                f.write(zip_res.content)
            
            # Extract
            text_content = ""
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                for name in zip_ref.namelist():
                    if name.endswith('.md') or name.endswith('.txt'):
                        with zip_ref.open(name) as f:
                            text_content += f.read().decode('utf-8') + "\n\n"
            
            if not text_content:
                print(json.dumps({"error": "No markdown/text output found in ZIP"}))
                sys.exit(1)
                
            print(json.dumps({
                "success": True,
                "text": text_content,
                "job_id": job_id
            }))
            
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
