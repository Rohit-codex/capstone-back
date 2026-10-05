/**
 * Default Design Templates for Document Generation
 * These provide professional pre-configured styling options
 */

export const DESIGN_TEMPLATES = {
    professional: {
        name: 'Professional',
        description: 'Traditional legal document style with Times New Roman and formal formatting',
        config: {
            fontFamily: 'Times New Roman',
            fontSize: 12,
            headingSize: 14,
            titleAlignment: 'center',
            bodyAlignment: 'justified',
            titleBold: true,
            titleUnderline: false,
            titleItalic: false,
            lineSpacing: 1.5,
            margins: {
                top: 1440, // 1 inch in twips (1440 twips = 1 inch)
                right: 1440,
                bottom: 1440,
                left: 1440
            },
            paragraphSpacing: {
                before: 6, // points
                after: 6
            },
            firstLineIndent: 0,
            textTransform: 'none',
            pageSize: 'A4',
            pageOrientation: 'portrait',
            colorScheme: {
                primary: '#000000',
                accent: '#000000'
            },
            borderStyle: 'none'
        }
    },

    modern: {
        name: 'Modern',
        description: 'Clean and contemporary design with Calibri and minimal formatting',
        config: {
            fontFamily: 'Calibri',
            fontSize: 11,
            headingSize: 13,
            titleAlignment: 'left',
            bodyAlignment: 'left',
            titleBold: true,
            titleUnderline: false,
            titleItalic: false,
            lineSpacing: 1.15,
            margins: {
                top: 1080, // 0.75 inch
                right: 1080,
                bottom: 1080,
                left: 1080
            },
            paragraphSpacing: {
                before: 4,
                after: 4
            },
            firstLineIndent: 0,
            textTransform: 'none',
            pageSize: 'A4',
            pageOrientation: 'portrait',
            colorScheme: {
                primary: '#1a1a1a',
                accent: '#2563eb'
            },
            borderStyle: 'none'
        }
    },

    classic: {
        name: 'Classic',
        description: 'Traditional court document style with Garamond and classic formatting',
        config: {
            fontFamily: 'Garamond',
            fontSize: 12,
            headingSize: 14,
            titleAlignment: 'center',
            bodyAlignment: 'justified',
            titleBold: true,
            titleUnderline: true,
            titleItalic: false,
            lineSpacing: 2.0,
            margins: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440
            },
            paragraphSpacing: {
                before: 8,
                after: 8
            },
            firstLineIndent: 720, // 0.5 inch first line indent
            textTransform: 'none',
            pageSize: 'Legal',
            pageOrientation: 'portrait',
            colorScheme: {
                primary: '#000000',
                accent: '#000000'
            },
            borderStyle: 'single',
            borderWidth: 1,
            borderColor: '#000000'
        }
    }
};

/**
 * Get design template by name
 */
export function getDesignTemplate(templateName) {
    if (!templateName || templateName === 'none') {
        return null;
    }

    const template = DESIGN_TEMPLATES[templateName.toLowerCase()];
    if (!template) {
        console.warn(`Unknown design template: ${templateName}, using Professional`);
        return DESIGN_TEMPLATES.professional.config;
    }

    return template.config;
}

/**
 * Get list of available templates for frontend
 */
export function getAvailableTemplates() {
    return Object.entries(DESIGN_TEMPLATES).map(([key, template]) => ({
        id: key,
        name: template.name,
        description: template.description
    }));
}

export default {
    DESIGN_TEMPLATES,
    getDesignTemplate,
    getAvailableTemplates
};
