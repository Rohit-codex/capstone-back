import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  useToast,
  HStack,
  PinInput,
  PinInputField,
  useColorMode,
  useColorModeValue,
  IconButton,
  Container,
} from '@chakra-ui/react';
import { SunIcon, MoonIcon } from '@chakra-ui/icons';
import { ArrowBackIcon } from '@chakra-ui/icons';
import { motion } from 'framer-motion';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { login: authLogin, signup: authSignup, user, setSession } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState(1); // 1: email check, 2: login, 3: signup
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorEmail, setTwoFactorEmail] = useState('');
  const [twoFactorOtp, setTwoFactorOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState(0); // 0: not in flow, 1: otp, 2: new password
  const [resetOtp, setResetOtp] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  // Color mode values
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const textColor = useColorModeValue('gray.600', 'gray.300');
  const headingColor = useColorModeValue('gray.800', 'white');

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      if (user.isAdmin) {
        navigate('/admin/dashboard');
      } else {
        navigate('/chat');
      }
    }
  }, [user, navigate]);

  const handleEmailCheck = async () => {
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/check-email', { email });
      
      if (response.data.exists) {
        setStep(2); // User exists, show login form
      } else {
        setStep(3); // New user, show signup form
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Something went wrong',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      setLoading(true);
      const result = await authLogin(email, password);
      
      if (result.requiresTwoFactor) {
        setTwoFactorRequired(true);
        setTwoFactorEmail(result.email || email);
        toast({
          title: 'OTP Sent',
          description: 'Enter the OTP sent to your email to complete login.',
          status: 'info',
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      if (result.success) {
        toast({
          title: 'Success',
          description: 'Logged in successfully',
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
        
        // Redirect based on user role
        if (result.isAdmin) {
          navigate('/admin/dashboard');
        } else {
          navigate('/chat');
        }
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Invalid credentials',
          status: 'error',
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Invalid credentials',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTwoFactor = async () => {
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/verify-2fa', {
        email: twoFactorEmail,
        otp: twoFactorOtp
      });
      const { token, refreshToken, csrfToken, user } = response.data;
      setSession({ token, refreshToken, csrfToken, user });
      toast({
        title: 'Success',
        description: 'Logged in successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      if (user?.isAdmin) {
        navigate('/admin/dashboard');
      } else {
        navigate('/chat');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'OTP verification failed',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    try {
      setLoading(true);
      const result = await authSignup({
        firstName,
        lastName,
        email,
        password,
        confirmPassword,
        otp
      });

      if (result.success) {
        toast({
          title: 'Success',
          description: 'Account created successfully',
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
        navigate('/chat');
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Error creating account',
          status: 'error',
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Error creating account',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box 
      minH="100vh" 
      display="flex" 
      alignItems="center" 
      justifyContent="center" 
      bg={useColorModeValue('gray.50', 'gray.900')}
      transition="all 0.2s"
    >
      <Container maxW="container.sm" px={4}>
        <Box position="fixed" top={4} right={4}>
          <IconButton
            icon={colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
            onClick={toggleColorMode}
            variant="ghost"
            aria-label="Toggle color mode"
            size="lg"
          />
        </Box>

        <Box
          p={8}
          borderRadius="xl"
          boxShadow="xl"
          bg={bgColor}
          borderWidth={1}
          borderColor={borderColor}
          transition="all 0.2s"
          position="relative"
        >
          {/* Back Arrow inside the card */}
          {step === 2 && forgotStep === 0 && (
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.3 }}
              style={{ position: 'absolute', top: 24, left: 24, zIndex: 2 }}
            >
              <IconButton
                icon={<ArrowBackIcon />}
                aria-label="Back to email"
                variant="ghost"
                colorScheme="blue"
                size="md"
                onClick={() => {
                  setStep(1);
                  setPassword('');
                }}
                _hover={{ transform: 'scale(1.15)', bg: 'blue.50' }}
                _active={{ bg: 'blue.100' }}
              />
            </motion.div>
          )}
            <Heading 
              textAlign="center" 
              size="xl" 
              color={headingColor}
              letterSpacing="tight"
              mt={step === 2 && forgotStep === 0 ? 8 : 0}
            >
              Law AI
            </Heading>
            
            {step === 1 && (
              <VStack spacing={8} align="stretch">
                <Text textAlign="center" color={textColor} fontSize="lg">
                  Enter your email to continue
                </Text>
                <FormControl>
                  <FormLabel color={textColor} mb={2}>Email</FormLabel>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    size="lg"
                    borderRadius="md"
                    _focus={{
                      borderColor: 'blue.400',
                      boxShadow: 'outline',
                    }}
                  />
                </FormControl>
                <Button
                  colorScheme="blue"
                  size="lg"
                  onClick={handleEmailCheck}
                  isLoading={loading}
                  w="full"
                  borderRadius="md"
                  _hover={{
                    transform: 'translateY(-2px)',
                    boxShadow: 'lg',
                  }}
                  transition="all 0.2s"
                >
                  Continue
                </Button>
              </VStack>
            )}

            {step === 2 && forgotStep === 0 && (
              <VStack spacing={8} align="stretch">
                {!twoFactorRequired ? (
                  <>
                    <Text textAlign="center" color={textColor} fontSize="lg">
                      Welcome back! Please enter your password
                    </Text>
                    <FormControl>
                      <FormLabel color={textColor} mb={2}>Password</FormLabel>
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        size="lg"
                        borderRadius="md"
                        _focus={{
                          borderColor: 'blue.400',
                          boxShadow: 'outline',
                        }}
                      />
                    </FormControl>
                    <VStack spacing={4}>
                      <Button
                        colorScheme="blue"
                        size="lg"
                        onClick={handleLogin}
                        isLoading={loading}
                        w="full"
                        borderRadius="md"
                        _hover={{
                          transform: 'translateY(-2px)',
                          boxShadow: 'lg',
                        }}
                        transition="all 0.2s"
                      >
                        Login
                      </Button>
                      <Button
                        variant="link"
                        colorScheme="blue"
                        onClick={async () => {
                          setLoading(true);
                          try {
                            await axios.post('/auth/forgot-password', { email });
                            toast({
                              title: 'OTP Sent',
                              description: 'If this email exists, an OTP has been sent.',
                              status: 'info',
                              duration: 3000,
                              isClosable: true,
                            });
                            setForgotStep(1);
                          } catch (error) {
                            toast({
                              title: 'Error',
                              description: error.response?.data?.message || 'Failed to send OTP',
                              status: 'error',
                              duration: 3000,
                              isClosable: true,
                            });
                          } finally {
                            setLoading(false);
                          }
                        }}
                        mt={2}
                      >
                        Forgot Password?
                      </Button>
                    </VStack>
                  </>
                ) : (
                  <>
                    <Text textAlign="center" color={textColor} fontSize="lg">
                      Enter the OTP sent to {twoFactorEmail}
                    </Text>
                    <HStack justify="center">
                      <PinInput otp value={twoFactorOtp} onChange={setTwoFactorOtp}>
                        <PinInputField />
                        <PinInputField />
                        <PinInputField />
                        <PinInputField />
                        <PinInputField />
                        <PinInputField />
                      </PinInput>
                    </HStack>
                    <Button
                      colorScheme="blue"
                      size="lg"
                      onClick={handleVerifyTwoFactor}
                      isLoading={loading}
                      w="full"
                      borderRadius="md"
                      _hover={{
                        transform: 'translateY(-2px)',
                        boxShadow: 'lg',
                      }}
                      transition="all 0.2s"
                    >
                      Verify OTP
                    </Button>
                  </>
                )}
              </VStack>
            )}

            {/* Forgot Password Step 1: OTP Entry */}
            {step === 2 && forgotStep === 1 && (
              <VStack spacing={8} align="stretch">
                <Text textAlign="center" color={textColor} fontSize="lg">
                  Enter the OTP sent to <b>{email}</b>
                </Text>
                <FormControl>
                  <FormLabel color={textColor} mb={2}>OTP</FormLabel>
                  <Input
                    type="text"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value)}
                    placeholder="Enter OTP"
                    size="lg"
                    borderRadius="md"
                    _focus={{
                      borderColor: 'blue.400',
                      boxShadow: 'outline',
                    }}
                  />
                </FormControl>
                <Button
                  colorScheme="blue"
                  size="lg"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await axios.post('/auth/verify-reset-otp', { email, otp: resetOtp });
                      toast({
                        title: 'OTP Verified',
                        description: 'OTP verified. Please enter your new password.',
                        status: 'success',
                        duration: 3000,
                        isClosable: true,
                      });
                      setForgotStep(2);
                    } catch (error) {
                      toast({
                        title: 'Error',
                        description: error.response?.data?.message || 'Invalid or expired OTP',
                        status: 'error',
                        duration: 3000,
                        isClosable: true,
                      });
                    } finally {
                      setLoading(false);
                    }
                  }}
                  w="full"
                  borderRadius="md"
                  mt={4}
                  _hover={{
                    transform: 'translateY(-2px)',
                    boxShadow: 'lg',
                  }}
                  transition="all 0.2s"
                >
                  Verify OTP
                </Button>
              </VStack>
            )}

            {/* Forgot Password Step 2: New Password Entry */}
            {step === 2 && forgotStep === 2 && (
              <VStack spacing={8} align="stretch">
                <Text textAlign="center" color={textColor} fontSize="lg">
                  Enter your new password for <b>{email}</b>
                </Text>
                <FormControl>
                  <FormLabel color={textColor} mb={2}>New Password</FormLabel>
                  <Input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="New password"
                    size="lg"
                    borderRadius="md"
                    _focus={{
                      borderColor: 'blue.400',
                      boxShadow: 'outline',
                    }}
                  />
                </FormControl>
                <FormControl mt={2}>
                  <FormLabel color={textColor} mb={2}>Confirm New Password</FormLabel>
                  <Input
                    type="password"
                    value={resetConfirmPassword}
                    onChange={(e) => setResetConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    size="lg"
                    borderRadius="md"
                    _focus={{
                      borderColor: 'blue.400',
                      boxShadow: 'outline',
                    }}
                  />
                </FormControl>
                <Button
                  colorScheme="blue"
                  size="lg"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await axios.post('/auth/reset-password', {
                        email,
                        otp: resetOtp,
                        newPassword: resetPassword,
                        confirmPassword: resetConfirmPassword,
                      });
                      toast({
                        title: 'Password Reset',
                        description: 'Your password has been reset. Please login.',
                        status: 'success',
                        duration: 3000,
                        isClosable: true,
                      });
                      setForgotStep(0);
                      setStep(2);
                      setPassword('');
                      setResetOtp('');
                      setResetPassword('');
                      setResetConfirmPassword('');
                    } catch (error) {
                      toast({
                        title: 'Error',
                        description: error.response?.data?.message || 'Failed to reset password',
                        status: 'error',
                        duration: 3000,
                        isClosable: true,
                      });
                    } finally {
                      setLoading(false);
                    }
                  }}
                  w="full"
                  borderRadius="md"
                  mt={4}
                  _hover={{
                    transform: 'translateY(-2px)',
                    boxShadow: 'lg',
                  }}
                  transition="all 0.2s"
                >
                  Reset Password
                </Button>
              </VStack>
            )}

            {step === 3 && (
              <>
                <Text textAlign="center" color={textColor} fontSize="lg">
                  Create your account
                </Text>
                <FormControl>
                  <FormLabel color={textColor}>First Name</FormLabel>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Enter your first name"
                    size="lg"
                    borderRadius="md"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel color={textColor}>Last Name</FormLabel>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Enter your last name"
                    size="lg"
                    borderRadius="md"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel color={textColor}>Password</FormLabel>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    size="lg"
                    borderRadius="md"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel color={textColor}>Confirm Password</FormLabel>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    size="lg"
                    borderRadius="md"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel color={textColor}>OTP</FormLabel>
                  <HStack justify="center" spacing={2}>
                    <PinInput
                      value={otp}
                      onChange={setOtp}
                      type="number"
                      size="lg"
                      mask
                    >
                      <PinInputField />
                      <PinInputField />
                      <PinInputField />
                      <PinInputField />
                      <PinInputField />
                      <PinInputField />
                    </PinInput>
                  </HStack>
                  <Text fontSize="sm" color={textColor} mt={2} textAlign="center">
                    Check your email for the OTP
                  </Text>
                </FormControl>
                <VStack spacing={4}>
                  <Button
                    colorScheme="blue"
                    size="lg"
                    onClick={handleSignup}
                    isLoading={loading}
                    w="full"
                    borderRadius="md"
                    _hover={{
                      transform: 'translateY(-2px)',
                      boxShadow: 'lg',
                    }}
                    transition="all 0.2s"
                  >
                    Create Account
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setStep(1)}
                    size="lg"
                    w="full"
                    color={textColor}
                  >
                    Back
                  </Button>
                </VStack>
              </>
            )}
          </Box>
        </Container>
    </Box>
  );
};

export default Login; 