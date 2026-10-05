import { Box, Container, Heading, Text, VStack, Button, useToast, Flex, Input, FormControl, FormLabel, FormHelperText, Collapse, Badge, Spinner, HStack } from '@chakra-ui/react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createOrder, verifyPayment, getSubscriptionStatus, validateCoupon, getSubscriptionPrice } from '../services/subscriptionService';
import { ArrowBackIcon } from '@chakra-ui/icons';

const Subscription = () => {
  const [loading, setLoading] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponStatus, setCouponStatus] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [discountedPrice, setDiscountedPrice] = useState(null);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [currentPrice, setCurrentPrice] = useState(499);
  const toast = useToast();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();

  useEffect(() => {
    fetchSubscriptionStatus();
    fetchCurrentPrice();
  }, []);

  const fetchSubscriptionStatus = async () => {
    try {
      const response = await getSubscriptionStatus();
      setSubscriptionStatus(response.subscription);
    } catch (error) {
      console.error('Error fetching subscription status:', error);
    }
  };

  const fetchCurrentPrice = async () => {
    try {
      const response = await getSubscriptionPrice();
      setCurrentPrice(response.price);
    } catch (error) {
      console.error('Error fetching subscription price:', error);
    }
  };

  const handleCouponValidation = async () => {
    setCouponLoading(true);
    setCouponStatus(null);
    try {
      const result = await validateCoupon(couponCode);
      if (result && result.success && result.coupon) {
        setCouponStatus('valid');
        setAppliedCoupon(result.coupon);
        const discount = result.coupon.discountPercentage || 0;
        const newPrice = Math.round(currentPrice * (1 - discount / 100));
        setDiscountedPrice(newPrice);
        toast({
          title: 'Coupon applied!',
          description: `You got ${discount}% off!`,
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
      } else {
        setCouponStatus('invalid');
        setAppliedCoupon(null);
        setDiscountedPrice(null);
        toast({
          title: 'Invalid coupon',
          description: 'Please check your code and try again.',
          status: 'error',
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (err) {
      setCouponStatus('invalid');
      setAppliedCoupon(null);
      setDiscountedPrice(null);
      toast({
        title: 'Invalid coupon',
        description: 'Please check your code and try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponCode('');
    setCouponStatus(null);
    setAppliedCoupon(null);
    setDiscountedPrice(null);
  };

  const plans = [
    {
      name: 'Free Plan',
      price: '₹0',
      features: [
        '5 messages per day',
        'Basic chat features',
        'Standard support',
        'No credit card required'
      ],
      isPopular: false,
      bg: 'white',
      border: '1px solid',
      borderColor: 'gray.200',
      color: 'gray.800',
      buttonVariant: 'outline',
      buttonColorScheme: 'gray',
    },
    {
      name: 'Premium Plan',
      price: `₹${currentPrice}`,
      features: [
        'Unlimited messages',
        'Priority support',
        'Advanced features',
        'Ad-free experience'
      ],
      isPopular: true,
      bg: 'blue.50',
      border: '2px solid',
      borderColor: 'blue.400',
      color: 'blue.900',
      buttonVariant: 'solid',
      buttonColorScheme: 'blue',
    }
  ];

  const initializeRazorpay = () => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => {
        resolve(true);
      };
      script.onerror = () => {
        resolve(false);
      };
      document.body.appendChild(script);
    });
  };

  const handleSubscribe = async (plan) => {
    if (plan.name === 'Free Plan') {
      toast({
        title: 'Already on Free Plan',
        description: 'You are currently on the free plan.',
        status: 'info',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setLoading(true);
    try {
      const res = await initializeRazorpay();
      if (!res) {
        toast({
          title: 'Error',
          description: 'Razorpay SDK failed to load',
          status: 'error',
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      const orderData = await createOrder(currentPrice * 100, appliedCoupon?.code);
      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'Law AI',
        description: 'Premium Subscription',
        order_id: orderData.order.id,
        handler: async function (response) {
          try {
            const paymentData = {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              plan: 'premium'
            };
            const result = await verifyPayment(paymentData);
            if (result.success) {
              toast({
                title: 'Success',
                description: 'Premium subscription activated successfully!',
                status: 'success',
                duration: 5000,
                isClosable: true,
              });
              updateUser(prev => ({ ...prev, subscriptionStatus: 'premium' }));
              fetchSubscriptionStatus();
              setAppliedCoupon(null);
              setCouponCode('');
            }
          } catch (error) {
            toast({
              title: 'Error',
              description: error.message || 'Payment verification failed',
              status: 'error',
              duration: 5000,
              isClosable: true,
            });
          }
        },
        prefill: {
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
        },
        theme: {
          color: '#2563EB',
        },
      };
      const paymentObject = new window.Razorpay(options);
      paymentObject.open();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxW="container.md" py={12}>
      <Button
        variant="ghost"
        colorScheme="blue"
        leftIcon={<ArrowBackIcon />}
        onClick={() => navigate(-1)}
        mb={4}
        alignSelf="flex-start"
      >
        Back
      </Button>
      <Heading textAlign="center" mb={2}>
        Choose Your Plan
      </Heading>
      <Text textAlign="center" color="gray.400" fontWeight="medium">
        Select the plan that best suits your needs
      </Text>

      {/* Coupon Section */}
      <Box w="full" maxW="400px" py={4} mb={8}>
        <Button
          variant="link"
          colorScheme="blue"
          onClick={() => setShowCouponInput(!showCouponInput)}
          mb={2}
        >
          {showCouponInput ? 'Hide Coupon' : 'Have a coupon?'}
        </Button>
        <Collapse in={showCouponInput}>
          <Box p={4} borderWidth="1px" borderRadius="md" bg="white">
            <VStack spacing={4}>
              <FormControl>
                <FormLabel>Coupon</FormLabel>
                <HStack>
                  <Input
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value)}
                    placeholder="Enter coupon code"
                    isDisabled={!!appliedCoupon}
                    color="gray.800"
                    bg="white"
                    _placeholder={{ color: "gray.500" }}
                  />
                  {!appliedCoupon ? (
                    <Button
                      colorScheme="blue"
                      onClick={handleCouponValidation}
                      isLoading={couponLoading}
                      disabled={!couponCode}
                    >
                      Apply
                    </Button>
                  ) : (
                    <Button colorScheme="red" onClick={handleRemoveCoupon}>
                      Remove Coupon
                    </Button>
                  )}
                </HStack>
                <Box mt={2} minH="24px">
                  {couponStatus === 'valid' && appliedCoupon && (
                    <Badge colorScheme="green">
                      Coupon {appliedCoupon.code} applied! {appliedCoupon.discountPercentage}% off
                    </Badge>
                  )}
                  {couponStatus === 'invalid' && (
                    <Text color="red.400" fontSize="sm">Invalid coupon code.</Text>
                  )}
                </Box>
              </FormControl>
            </VStack>
          </Box>
        </Collapse>
      </Box>

      <Flex
        direction={{ base: 'column', md: 'row' }}
        gap={8}
        justify="center"
        align="center"
        w="full"
      >
        {plans.map((plan) => {
          const isCurrent =
            (subscriptionStatus?.plan === 'premium' && plan.name === 'Premium Plan') ||
            (subscriptionStatus?.plan !== 'premium' && plan.name === 'Free Plan');
          const displayPrice = (appliedCoupon && plan.name === 'Premium Plan' && discountedPrice !== null)
            ? `₹${discountedPrice}`
            : plan.price;
          return (
            <Box
              key={plan.name}
              p={8}
              borderRadius="2xl"
              boxShadow={plan.isPopular ? '2xl' : 'md'}
              w={{ base: 'full', md: '380px' }}
              position="relative"
              bg={plan.bg}
              border={plan.border}
              borderColor={plan.borderColor}
              color={plan.color}
              transition="transform 0.2s, box-shadow 0.2s"
              _hover={{
                transform: 'translateY(-4px) scale(1.03)',
                boxShadow: 'xl',
              }}
              minH="420px"
              display="flex"
              flexDirection="column"
              justifyContent="space-between"
            >
              {plan.isPopular && (
                <Box
                  position="absolute"
                  top="-4"
                  right="4"
                  bg="blue.500"
                  color="white"
                  px={4}
                  py={1}
                  borderRadius="full"
                  fontSize="sm"
                  fontWeight="bold"
                  zIndex={1}
                >
                  Popular
                </Box>
              )}
              <VStack spacing={4} align="stretch" mb={4}>
                <Heading size="lg" fontWeight="bold" color={plan.isPopular ? 'blue.700' : 'gray.700'}>
                  {plan.name}
                </Heading>
                <Text fontSize="3xl" fontWeight="extrabold">
                  {displayPrice}
                  <Text as="span" fontSize="md" fontWeight="normal" color="gray.500">
                    /month
                  </Text>
                </Text>
                {appliedCoupon && plan.name === 'Premium Plan' && (
                  <Badge colorScheme="green" alignSelf="start">
                    {appliedCoupon.discountPercentage}% off
                  </Badge>
                )}
                <VStack align="stretch" spacing={3} mt={2}>
                  {plan.features.map((feature) => (
                    <Flex key={feature} align="center">
                      <Text color="green.400" mr={2} fontSize="lg">✓</Text>
                      <Text color={plan.isPopular ? 'blue.900' : 'gray.700'} fontWeight="medium">{feature}</Text>
                    </Flex>
                  ))}
                </VStack>
              </VStack>
              <Button
                colorScheme={plan.buttonColorScheme}
                variant={isCurrent ? 'outline' : plan.buttonVariant}
                size="lg"
                onClick={() => handleSubscribe(plan)}
                isLoading={loading}
                loadingText="Processing..."
                isDisabled={isCurrent}
                fontWeight="bold"
                mt={4}
                w="full"
                _hover={isCurrent ? { cursor: 'not-allowed', opacity: 0.8 } : {}}
              >
                {isCurrent ? 'Current Plan' : 'Upgrade Now'}
              </Button>
            </Box>
          );
        })}
      </Flex>
    </Container>
  );
};

export default Subscription; 