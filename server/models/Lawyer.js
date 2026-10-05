import mongoose from 'mongoose';

const lawyerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

const Lawyer = mongoose.model('Lawyer', lawyerSchema);
export default Lawyer;
