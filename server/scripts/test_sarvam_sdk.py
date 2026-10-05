import os
import time
from sarvamai import SarvamAI
import requests

def upload_file(url, file_path):
    with open(file_path, 'rb') as f:
        headers = {
            'x-ms-blob-type': 'BlockBlob'
        }
        res = requests.put(url, data=f, headers=headers)
        res.raise_for_status()

api_key = os.environ.get("sarvamai")
client = SarvamAI(api_subscription_key=api_key)

with open('test.pdf', 'wb') as f:
    f.write(b'%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n')

# Create job
res = client.document_intelligence.initialise(job_parameters={"language": "en-IN", "output_format": "md"})
print("Init:", res)

# The response probably has upload links? No, wait, there's a get_upload_links method.
