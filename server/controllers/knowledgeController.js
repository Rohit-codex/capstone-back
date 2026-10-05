import { AppError } from '../utils/errors.js';
import { knowledgeBase } from '../utils/knowledgeBase.js';


export const addLaw = async (req, res) => {
  try {
    const { title, description, content, category, act, sections, effectiveDate } = req.body;
    
    if (!title || !description || !content) {
      throw new AppError('Title, description, and content are required', 400);
    }

    const lawData = {
      title,
      description,
      content,
      category: category || 'General',
      act: act || null,
      sections: sections || [],
      effectiveDate: effectiveDate || new Date().toISOString(),
      addedBy: req.user.id
    };

    const lawId = await knowledgeBase.addLaw(lawData);
    
    res.json({
      success: true,
      message: 'Law added successfully',
      lawId,
      law: lawData
    });
  } catch (error) {
    throw new AppError(error.message || 'Error adding law', 500);
  }
};


export const addCase = async (req, res) => {
  try {
    const { title, court, year, summary, facts, judgment, jurisdiction, citation } = req.body;
    
    if (!title || !court || !summary) {
      throw new AppError('Title, court, and summary are required', 400);
    }

    const caseData = {
      title,
      court,
      year: year || new Date().getFullYear(),
      summary,
      facts: facts || '',
      judgment: judgment || '',
      jurisdiction: jurisdiction || 'India',
      citation: citation || '',
      addedBy: req.user.id
    };

    const caseId = await knowledgeBase.addCase(caseData);
    
    res.json({
      success: true,
      message: 'Case added successfully',
      caseId,
      case: caseData
    });
  } catch (error) {
    throw new AppError(error.message || 'Error adding case', 500);
  }
};


export const addSection = async (req, res) => {
  try {
    const { act, number, title, content, subsection, explanation } = req.body;
    
    if (!act || !number || !content) {
      throw new AppError('Act, section number, and content are required', 400);
    }

    const sectionData = {
      act,
      number,
      title: title || `Section ${number}`,
      content,
      subsection: subsection || null,
      explanation: explanation || '',
      addedBy: req.user.id
    };

    const sectionId = await knowledgeBase.addSection(sectionData);
    
    res.json({
      success: true,
      message: 'Section added successfully',
      sectionId,
      section: sectionData
    });
  } catch (error) {
    throw new AppError(error.message || 'Error adding section', 500);
  }
};


export const searchKnowledge = async (req, res) => {
  try {
    const { query, type, category, jurisdiction } = req.query;
    
    if (!query) {
      throw new AppError('Search query is required', 400);
    }

    let results = {};

    if (!type || type === 'laws') {
      results.laws = knowledgeBase.searchLaws(query, category);
    }

    if (!type || type === 'cases') {
      results.cases = knowledgeBase.searchCases(query, jurisdiction);
    }

    if (!type || type === 'sections') {
      results.sections = knowledgeBase.searchSections(query, category);
    }

    res.json({
      success: true,
      query,
      results,
      totalResults: Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
    });
  } catch (error) {
    throw new AppError(error.message || 'Error searching knowledge base', 500);
  }
};


export const getKnowledgeStats = async (req, res) => {
  try {
    res.json({
      success: true,
      stats: {
        totalLaws: knowledgeBase.laws.size,
        totalCases: knowledgeBase.cases.size,
        totalSections: knowledgeBase.sections.size,
        categories: {
          laws: [...new Set(Array.from(knowledgeBase.laws.values()).map(l => l.category))],
          jurisdictions: [...new Set(Array.from(knowledgeBase.cases.values()).map(c => c.jurisdiction))]
        }
      }
    });
  } catch (error) {
    throw new AppError(error.message || 'Error getting knowledge stats', 500);
  }
};

export default {
  addLaw,
  addCase,
  addSection,
  searchKnowledge,
  getKnowledgeStats
};
