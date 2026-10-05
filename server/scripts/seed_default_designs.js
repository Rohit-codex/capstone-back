import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TemplateDesign from '../models/TemplateDesign.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const DEFAULT_DESIGNS = [
    {
        name: 'Professional',
        description: 'Traditional legal document style with Times New Roman and formal formatting',
        isUniversal: true,
        isDefault: true,
        isActive: true,
        sortOrder: 1,
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
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440
            },
            paragraphSpacing: {
                before: 6,
                after: 6
            },
            firstLineIndent: 0,
            textTransform: 'none',
            pageSize: 'A4',
            pageOrientation: 'portrait',
            colorScheme: {
                primary: '#000000',
                accent: '#000000',
                background: '#ffffff'
            },
            borderStyle: 'none'
        }
    },
    {
        name: 'Modern',
        description: 'Clean and contemporary design with Calibri and minimal formatting',
        isUniversal: true,
        isDefault: false,
        isActive: true,
        sortOrder: 2,
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
                top: 1080,
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
                accent: '#2563eb',
                background: '#ffffff'
            },
            borderStyle: 'none'
        }
    },
    {
        name: 'Classic',
        description: 'Traditional court document style with Garamond and classic formatting',
        isUniversal: true,
        isDefault: false,
        isActive: true,
        sortOrder: 3,
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
            firstLineIndent: 720,
            textTransform: 'none',
            pageSize: 'Legal',
            pageOrientation: 'portrait',
            colorScheme: {
                primary: '#000000',
                accent: '#000000',
                background: '#ffffff'
            },
            borderStyle: 'single',
            borderColor: '#000000',
            borderWidth: 1
        }
    }
];

async function seedDefaultDesigns() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        console.log('🔍 Checking existing designs...');
        const existingCount = await TemplateDesign.countDocuments();
        console.log(`   Found ${existingCount} existing designs`);

        if (existingCount > 0) {
            console.log('⚠️  Designs already exist. Delete them first? (y/n)');
            console.log('   Run with --force to automatically overwrite');

            if (process.argv.includes('--force')) {
                console.log('🗑️  Deleting existing designs...');
                await TemplateDesign.deleteMany({});
                console.log('✅ Deleted all existing designs');
            } else {
                console.log('❌ Skipping seed - designs already exist');
                process.exit(0);
            }
        }

        console.log('📝 Creating default designs...');

        for (const design of DEFAULT_DESIGNS) {
            console.log(`   → Creating "${design.name}"...`);
            await TemplateDesign.create(design);
        }

        console.log('\n✅ Successfully seeded 3 default designs!');
        console.log('   - Professional (default)');
        console.log('   - Modern');
        console.log('   - Classic');

        const finalCount = await TemplateDesign.countDocuments();
        console.log(`\n📊 Total designs in database: ${finalCount}`);

    } catch (error) {
        console.error('❌ Error seeding designs:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\n👋 Database connection closed');
    }
}

seedDefaultDesigns();
