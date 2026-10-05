# Use Node.js 20 Alpine image (required by joi, pdf-parse, pdfjs-dist)
FROM node:20-alpine

# Install LibreOffice headless + fonts for PDF generation with full formatting fidelity
# Also installs dependencies needed by Puppeteer (headless Chrome) as fallback
RUN apk add --no-cache \
    libreoffice \
    font-noto \
    font-noto-cjk \
    ttf-freefont \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (npm install used instead of npm ci to avoid lock file sync issues with optional peer deps like gcp-metadata)
RUN npm install --omit=dev

# Copy server source code
COPY . ./

# Copy normalized templates into image
COPY normalized_templates ./normalized_templates

# Set template root for runtime
ENV TEMPLATE_ROOT=/app/normalized_templates

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/protected', (res) => { process.exit(res.statusCode === 401 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]
