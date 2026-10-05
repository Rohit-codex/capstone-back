import Lawyer from '../models/Lawyer.js';
import { AppError } from '../utils/errors.js';

export const listLawyers = async (req, res) => {
  try {
    const lawyers = await Lawyer.find().sort({ createdAt: -1 }).lean();
    res.json(lawyers);
  } catch (error) {
    throw new AppError(error.message || 'Error fetching lawyers', 500);
  }
};

export const createLawyer = async (req, res) => {
  try {
    const { name, phone, email, address } = req.body;
    if (!name || !phone || !email || !address) {
      throw new AppError('All fields are required', 400);
    }
    const lawyer = await Lawyer.create({ name, phone, email, address });
    res.status(201).json(lawyer);
  } catch (error) {
    throw new AppError(error.message || 'Error creating lawyer', 500);
  }
};

export const updateLawyer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;
    const lawyer = await Lawyer.findByIdAndUpdate(
      id,
      { name, phone, email, address },
      { new: true }
    );
    if (!lawyer) {
      throw new AppError('Lawyer not found', 404);
    }
    res.json(lawyer);
  } catch (error) {
    throw new AppError(error.message || 'Error updating lawyer', 500);
  }
};

export const deleteLawyer = async (req, res) => {
  try {
    const { id } = req.params;
    const lawyer = await Lawyer.findByIdAndDelete(id);
    if (!lawyer) {
      throw new AppError('Lawyer not found', 404);
    }
    res.json({ success: true, message: 'Lawyer deleted successfully' });
  } catch (error) {
    throw new AppError(error.message || 'Error deleting lawyer', 500);
  }
};
