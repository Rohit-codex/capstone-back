import React, { useState, useEffect } from 'react';
import { 
  Box, 
  VStack, 
  HStack, 
  Text, 
  Button, 
  Table, 
  Thead, 
  Tbody, 
  Tr, 
  Th, 
  Td, 
  TableContainer,
  Select,
  Heading,
  useToast,
  Badge,
  Spinner,
  Avatar,
  SimpleGrid,
  Icon,
  Flex,
  Divider,
  useColorMode,
  useColorModeValue,
  IconButton,
  Link,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  ButtonGroup,
  FormControl,
  FormLabel,
  Input,
  Card,
  CardBody,
  CardHeader,
  Container,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Switch,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Textarea,
  Checkbox,
  CheckboxGroup,
  Stack,
  Wrap,
  WrapItem,
  Tag,
  TagLabel,
  TagCloseButton,
  Tooltip,
} from '@chakra-ui/react';
import { FaUsers, FaCrown, FaRupeeSign, FaMoon, FaSun, FaFile, FaImage, FaDownload, FaTrash, FaSignOutAlt, FaShieldAlt, FaPalette } from 'react-icons/fa';
import { FiDownload, FiTrash2, FiEdit, FiPlus, FiSettings, FiUpload } from 'react-icons/fi';
import { getAllUsers, removeUser, getFeatureAccessMatrix, updateFeatureAccessMatrix, updateUserTier, getTemplateDesigns, getTemplateDesignCategories, createTemplateDesign, updateTemplateDesign, deleteTemplateDesign, analyzeDocumentDesign } from '../services/adminService';
import { getAllFiles, deleteFile, downloadFile } from '../services/fileService';
import { useAuth } from '../context/AuthContext';
import { getSubscriptionPrice, updateSubscriptionPrice, createCoupon, getCoupons, editCoupon, deleteCoupon } from '../services/subscriptionService';
import { formatCurrency } from '../utils/format';
import { useNavigate } from 'react-router-dom';
import DesignCreatorModal from '../components/DesignCreatorModal';

// DesignPreviewPanel moved to DesignCreatorModal component

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { colorMode, toggleColorMode } = useColorMode();
  const [isLoading, setIsLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [isCreatingCoupon, setIsCreatingCoupon] = useState(false);
  const [newCoupon, setNewCoupon] = useState({
    code: '',
    discountPercentage: 0,
    maxUses: 1,
    validFrom: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isEditingCoupon, setIsEditingCoupon] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState(null);
  const [editCouponLoading, setEditCouponLoading] = useState(false);
  const [deleteCouponLoadingId, setDeleteCouponLoadingId] = useState(null);

  // Feature Access state
  const [featureMatrix, setFeatureMatrix] = useState([]);
  const [featureMatrixLoading, setFeatureMatrixLoading] = useState(false);
  const [featureMatrixDirty, setFeatureMatrixDirty] = useState(false);

  // Template Design state
  const [templateDesigns, setTemplateDesigns] = useState([]);
  const [templateCategories, setTemplateCategories] = useState([]);
  const [templateDesignLoading, setTemplateDesignLoading] = useState(false);
  const [isDesignModalOpen, setIsDesignModalOpen] = useState(false);
  const [editingDesign, setEditingDesign] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [designForm, setDesignForm] = useState({
    name: '',
    description: '',
    categories: [],
    isUniversal: false,
    isDefault: false,
    config: {
      fontFamily: 'Times New Roman',
      fontSize: 12,
      headingSize: 16,
      lineSpacing: 1.15,
      letterSpacing: 0,
      paragraphSpacing: { before: 0, after: 6 },
      textTransform: 'none',
      wordSpacing: 0,
      pageSize: 'A4',
      pageOrientation: 'portrait',
      margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      firstLineIndent: 0,
      titleAlignment: 'center',
      bodyAlignment: 'justified',
      titleBold: true,
      titleUnderline: false,
      titleItalic: false,
      headerText: '',
      footerText: '',
      headerAlignment: 'center',
      footerAlignment: 'center',
      showHeaderOnFirst: true,
      showFooterOnFirst: true,
      pageNumbering: 'none',
      borderStyle: 'none',
      borderColor: '#000000',
      borderWidth: 1,
      colorScheme: { primary: '#000000', accent: '#1a365d', background: '#ffffff' },
      watermarkText: '',
      watermarkOpacity: 0.1,
      images: [],
    }
  });

  // Color mode values
  const bgMain = useColorModeValue('gray.50', 'gray.900');
  const cardBg = useColorModeValue('white', 'gray.800');
  const cardShadow = useColorModeValue('md', 'dark-lg');
  const headingColor = useColorModeValue('blue.700', 'blue.300');
  const sectionTitle = useColorModeValue('gray.700', 'gray.200');
  const textColor = useColorModeValue('gray.600', 'gray.300');
  const tableHeaderBg = useColorModeValue('gray.100', 'gray.700');
  const tableRowHover = useColorModeValue('gray.50', 'gray.700');
  const badgeFreeBg = useColorModeValue('gray.200', 'gray.600');
  const badgeFreeColor = useColorModeValue('gray.700', 'gray.100');
  const badgePremiumBg = useColorModeValue('yellow.300', 'yellow.600');
  const badgePremiumColor = useColorModeValue('yellow.800', 'yellow.100');

  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/');
      return;
    }
    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [priceResponse, usersResponse, filesResponse, couponsResponse, featureResponse, designsResponse, categoriesResponse] = await Promise.all([
        getSubscriptionPrice(),
        getAllUsers(),
        getAllFiles(),
        getCoupons(),
        getFeatureAccessMatrix().catch(() => ({ features: [] })),
        getTemplateDesigns().catch(() => ({ designs: [] })),
        getTemplateDesignCategories().catch(() => ({ categories: [] })),
      ]);
      setCurrentPrice(priceResponse?.price || 0);
      setUsers(Array.isArray(usersResponse) ? usersResponse : (usersResponse?.data || []));
      setFiles(Array.isArray(filesResponse) ? filesResponse : []);
      setCoupons(couponsResponse?.coupons || []);
      setFeatureMatrix(featureResponse?.features || []);
      setTemplateDesigns(designsResponse?.designs || []);
      setTemplateCategories(categoriesResponse?.categories || []);
    } catch (error) {
        toast({
          title: 'Error',
        description: error.message || 'Failed to fetch data',
          status: 'error',
          duration: 5000,
        isClosable: true,
        });
      } finally {
      setIsLoading(false);
    }
  };

  const handlePriceUpdate = async (e) => {
    e.preventDefault();
    try {
      if (!currentPrice || currentPrice <= 0) {
        toast({
          title: 'Error',
          description: 'Please enter a valid price greater than 0',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        return;
      }
      await updateSubscriptionPrice(currentPrice);
      toast({
        title: 'Success',
        description: 'Subscription price updated',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update price',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleCreateCoupon = async () => {
    try {
      setIsCreatingCoupon(true);
      await createCoupon(newCoupon);
      toast({
        title: 'Success',
        description: 'Coupon created',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      onClose();
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create coupon',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsCreatingCoupon(false);
    }
  };

  const handleRemoveUser = async (userId) => {
    try {
      await removeUser(userId);
      setUsers(users.filter((user) => user._id !== userId));
      toast({
        title: 'Success',
        description: 'User removed',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to remove user',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleDeleteFile = async (fileId) => {
    try {
      await deleteFile(fileId);
      setFiles(files.filter((file) => file._id !== fileId));
      toast({
        title: 'Success',
        description: 'File deleted',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const getFileIcon = (mimeType) => {
    if (!mimeType) return FaFile;
    return mimeType.startsWith('image/') ? FaImage : FaFile;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Simple stats
  const totalUsers = users.length;
  const premiumUsers = users.filter(u => u.subscriptionStatus === 'premium').length;
  const totalRevenue = premiumUsers * currentPrice;

  const handleEditCoupon = (coupon) => {
    setEditingCoupon({ ...coupon });
    setIsEditingCoupon(true);
  };

  const handleEditCouponSubmit = async (e) => {
    e.preventDefault();
    setEditCouponLoading(true);
    try {
      await editCoupon(editingCoupon._id, editingCoupon);
      toast({
        title: 'Coupon updated',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      setIsEditingCoupon(false);
      setEditingCoupon(null);
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update coupon',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setEditCouponLoading(false);
    }
  };

  const handleDeleteCoupon = async (id) => {
    setDeleteCouponLoadingId(id);
    try {
      await deleteCoupon(id);
      toast({
        title: 'Coupon deleted',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete coupon',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setDeleteCouponLoadingId(null);
    }
  };

  // ============================================
  // FEATURE ACCESS HANDLERS
  // ============================================
  const handleFeatureToggle = (featureIndex, tier, field, value) => {
    const updated = [...featureMatrix];
    if (!updated[featureIndex][tier]) {
      updated[featureIndex][tier] = { enabled: false, limit: null };
    }
    updated[featureIndex][tier][field] = value;
    setFeatureMatrix(updated);
    setFeatureMatrixDirty(true);
  };

  const handleSaveFeatureMatrix = async () => {
    setFeatureMatrixLoading(true);
    try {
      await updateFeatureAccessMatrix(featureMatrix);
      setFeatureMatrixDirty(false);
      toast({ title: 'Feature access updated', status: 'success', duration: 3000, isClosable: true });
    } catch (error) {
      toast({ title: 'Error', description: error.message || 'Failed to save', status: 'error', duration: 5000, isClosable: true });
    } finally {
      setFeatureMatrixLoading(false);
    }
  };

  // ============================================
  // USER TIER HANDLERS
  // ============================================
  const handleUserTierChange = async (userId, newTier) => {
    try {
      await updateUserTier(userId, newTier);
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, userTier: newTier } : u));
      toast({ title: 'User tier updated', status: 'success', duration: 2000, isClosable: true });
    } catch (error) {
      toast({ title: 'Error', description: error.message || 'Failed to update tier', status: 'error', duration: 5000, isClosable: true });
    }
  };

  // ============================================
  // TEMPLATE DESIGN HANDLERS
  // ============================================
  const openDesignModal = (design = null) => {
    if (design) {
      setEditingDesign(design);
      setDesignForm({
        name: design.name,
        description: design.description || '',
        categories: design.categories || [],
        isUniversal: design.isUniversal || false,
        isDefault: design.isDefault || false,
        config: { ...designForm.config, ...(design.config || {}) }
      });
    } else {
      setEditingDesign(null);
      setDesignForm({
        name: '',
        description: '',
        categories: [],
        isUniversal: false,
        isDefault: false,
        config: {
          fontFamily: 'Times New Roman',
          fontSize: 12,
          headingSize: 16,
          lineSpacing: 1.15,
          letterSpacing: 0,
          paragraphSpacing: { before: 0, after: 6 },
          textTransform: 'none',
          wordSpacing: 0,
          pageSize: 'A4',
          pageOrientation: 'portrait',
          margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          firstLineIndent: 0,
          titleAlignment: 'center',
          bodyAlignment: 'justified',
          titleBold: true,
          titleUnderline: false,
          titleItalic: false,
          headerText: '',
          footerText: '',
          headerAlignment: 'center',
          footerAlignment: 'center',
          showHeaderOnFirst: true,
          showFooterOnFirst: true,
          pageNumbering: 'none',
          borderStyle: 'none',
          borderColor: '#000000',
          borderWidth: 1,
          colorScheme: { primary: '#000000', accent: '#1a365d', background: '#ffffff' },
          watermarkText: '',
          watermarkOpacity: 0.1,
          images: [],
        }
      });
    }
    setIsDesignModalOpen(true);
  };

  const handleSaveDesign = async () => {
    setTemplateDesignLoading(true);
    try {
      if (editingDesign) {
        await updateTemplateDesign(editingDesign._id, designForm);
      } else {
        await createTemplateDesign(designForm);
      }
      setIsDesignModalOpen(false);
      toast({ title: editingDesign ? 'Design updated' : 'Design created', status: 'success', duration: 3000, isClosable: true });
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: error.message || 'Failed to save design', status: 'error', duration: 5000, isClosable: true });
    } finally {
      setTemplateDesignLoading(false);
    }
  };

  const handleDeleteDesign = async (id) => {
    try {
      await deleteTemplateDesign(id);
      toast({ title: 'Design deleted', status: 'success', duration: 3000, isClosable: true });
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: error.message || 'Failed to delete', status: 'error', duration: 5000, isClosable: true });
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setIsAnalyzing(true);
      const result = await analyzeDocumentDesign(file);
      
      if (result.success && result.config) {
        setDesignForm(prev => ({
          ...prev,
          config: {
            ...prev.config,
            ...result.config
          }
        }));

        toast({
          title: 'Document Analyzed!',
          description: result.message || 'Format settings extracted successfully',
          status: 'success',
          duration: 4000,
          isClosable: true
        });
      }
    } catch (error) {
      console.error('Analysis error:', error);
      toast({
        title: 'Analysis Failed',
        description: error.message || 'Could not analyze document',
        status: 'error',
        duration: 4000,
        isClosable: true
      });
    } finally {
      setIsAnalyzing(false);
      e.target.value = '';
    }
  };

  return (
    <Container maxW="container.lg" py={8}>
      <VStack spacing={8} align="stretch">
        <Flex justify="space-between" align="center">
          <Heading>Admin Dashboard</Heading>
          <Button leftIcon={<FaSignOutAlt />} colorScheme="red" variant="outline" onClick={logout}>Logout</Button>
        </Flex>

        {/* Stats */}
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
          <Card>
            <CardBody>
              <HStack>
                <Icon as={FaUsers} boxSize={6} color="blue.500" />
                <Box>
                  <Text fontSize="sm">Total Users</Text>
                  <Text fontWeight="bold" fontSize="2xl">{totalUsers}</Text>
            </Box>
              </HStack>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <HStack>
                <Icon as={FaCrown} boxSize={6} color="yellow.500" />
                <Box>
                  <Text fontSize="sm">Premium Users</Text>
                  <Text fontWeight="bold" fontSize="2xl">{premiumUsers}</Text>
            </Box>
              </HStack>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <HStack>
                <Icon as={FaRupeeSign} boxSize={6} color="green.500" />
                <Box>
                  <Text fontSize="sm">Total Revenue</Text>
                  <Text fontWeight="bold" fontSize="2xl">{formatCurrency(totalRevenue)}</Text>
            </Box>
          </HStack>
            </CardBody>
          </Card>
        </SimpleGrid>

        {/* Subscription Price */}
        <Card>
          <CardHeader>
            <Heading size="md">Subscription Management</Heading>
          </CardHeader>
          <CardBody>
            <form onSubmit={handlePriceUpdate}>
              <HStack>
                <FormControl>
                  <FormLabel>Premium Subscription Price (₹)</FormLabel>
                  <NumberInput value={currentPrice} min={0} precision={2} onChange={val => setCurrentPrice(Number(val))}>
                    <NumberInputField />
                    <NumberInputStepper>
                      <NumberIncrementStepper />
                      <NumberDecrementStepper />
                    </NumberInputStepper>
                  </NumberInput>
                </FormControl>
                <Button type="submit" colorScheme="blue" isLoading={isLoading}>Update Price</Button>
              </HStack>
            </form>
          </CardBody>
        </Card>

        {/* User Management */}
        <Card boxShadow="lg" borderRadius="lg" mt={4}>
          <CardHeader pb={0}>
            <Heading size="md" color={headingColor}>User Management</Heading>
          </CardHeader>
          <CardBody>
            {isLoading ? <Spinner /> : (
          <TableContainer>
                <Table size="sm" variant="striped" colorScheme="gray">
              <Thead>
                <Tr>
                      <Th fontWeight="bold">Name</Th>
                      <Th fontWeight="bold">Email</Th>
                      <Th fontWeight="bold">Subscription</Th>
                      <Th fontWeight="bold">Tier</Th>
                      <Th fontWeight="bold">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                    {users.length === 0 ? (
                      <Tr><Td colSpan={5} textAlign="center">No users found.</Td></Tr>
                    ) : users.map(user => (
                      <Tr key={user._id} _hover={{ bg: tableRowHover }}>
                    <Td>{user.firstName} {user.lastName}</Td>
                    <Td>{user.email}</Td>
                        <Td>
                          <Badge colorScheme={user.subscriptionStatus === 'premium' ? 'yellow' : 'gray'}>
                            {(user.subscriptionStatus || 'free').toUpperCase()}
                          </Badge>
                        </Td>
                        <Td>
                          <Select
                            size="xs"
                            value={user.userTier || 'basic'}
                            onChange={(e) => handleUserTierChange(user._id, e.target.value)}
                            w="110px"
                          >
                            <option value="basic">Basic</option>
                            <option value="pro">Pro</option>
                            <option value="premium">Premium</option>
                          </Select>
                        </Td>
                        <Td>
                          <Button size="xs" colorScheme="red" onClick={() => handleRemoveUser(user._id)}>Remove</Button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TableContainer>
            )}
          </CardBody>
        </Card>

        {/* File Management */}
        <Card boxShadow="lg" borderRadius="lg" mt={4}>
          <CardHeader pb={0}>
            <Heading size="md" color={headingColor}>File Management</Heading>
          </CardHeader>
          <CardBody>
            <TableContainer>
              <Table size="sm" variant="striped" colorScheme="gray">
                <Thead>
                  <Tr>
                    <Th fontWeight="bold">File</Th>
                    <Th fontWeight="bold">Type</Th>
                    <Th fontWeight="bold">Size</Th>
                    <Th fontWeight="bold">Uploaded By</Th>
                    <Th fontWeight="bold">Uploaded At</Th>
                    <Th fontWeight="bold">Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {files.length === 0 ? (
                    <Tr><Td colSpan={6} textAlign="center">No files found.</Td></Tr>
                  ) : files.map(file => (
                    <Tr key={file._id} _hover={{ bg: tableRowHover }}>
                      <Td>
                        <HStack>
                          <Icon as={getFileIcon(file.fileType)} color="blue.400" />
                          <Text>{file.fileName}</Text>
                          {file.fileUrl && (
                            <IconButton
                              as="a"
                              href={file.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="Download"
                              icon={<FiDownload />}
                              size="xs"
                              colorScheme="blue"
                              variant="ghost"
                              ml={1}
                            />
                          )}
                        </HStack>
                      </Td>
                      <Td>{file.fileType}</Td>
                      <Td>{formatFileSize(file.fileSize)}</Td>
                      <Td>{file.uploadedBy?.email || 'Unknown'}</Td>
                      <Td>{new Date(file.createdAt).toLocaleDateString()}</Td>
                      <Td>
                        <IconButton
                          size="xs"
                          colorScheme="red"
                          variant="outline"
                          aria-label="Delete file"
                          icon={<FiTrash2 />}
                          onClick={() => handleDeleteFile(file._id)}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </CardBody>
        </Card>

        {/* Coupon Management */}
        <Card boxShadow="lg" borderRadius="lg" mt={4}>
          <CardHeader pb={0}>
            <HStack justify="space-between">
              <Heading size="md" color={headingColor}>Coupon Management</Heading>
              <Button colorScheme="blue" onClick={onOpen}>Create Coupon</Button>
            </HStack>
          </CardHeader>
          <CardBody>
            <TableContainer>
              <Table size="sm" variant="striped" colorScheme="gray">
                <Thead>
                  <Tr>
                    <Th fontWeight="bold">Code</Th>
                    <Th fontWeight="bold">Discount</Th>
                    <Th fontWeight="bold">Uses</Th>
                    <Th fontWeight="bold">Valid From</Th>
                    <Th fontWeight="bold">Valid Until</Th>
                    <Th fontWeight="bold">Status</Th>
                    <Th fontWeight="bold">Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {coupons.length === 0 ? (
                    <Tr><Td colSpan={7} textAlign="center">No coupons found.</Td></Tr>
                  ) : coupons.map(coupon => (
                    <Tr key={coupon._id} _hover={{ bg: tableRowHover }}>
                      <Td>{coupon.code}</Td>
                      <Td>{coupon.discountPercentage}%</Td>
                      <Td>{coupon.currentUses} / {coupon.maxUses}</Td>
                      <Td>{new Date(coupon.validFrom).toLocaleDateString()}</Td>
                      <Td>{new Date(coupon.validUntil).toLocaleDateString()}</Td>
                      <Td>
                        <Badge colorScheme={
                          !coupon.isActive
                            ? 'red'
                            : coupon.currentUses >= coupon.maxUses
                            ? 'orange'
                            : new Date() > new Date(coupon.validUntil)
                            ? 'red'
                            : 'green'
                        }>
                          {!coupon.isActive
                            ? 'Inactive'
                            : coupon.currentUses >= coupon.maxUses
                            ? 'Max Uses Reached'
                            : new Date() > new Date(coupon.validUntil)
                            ? 'Expired'
                            : 'Active'}
                        </Badge>
                      </Td>
                      <Td>
                        <HStack>
                          <Button size="xs" colorScheme="yellow" variant="outline" onClick={() => handleEditCoupon(coupon)}>
                            Edit
                          </Button>
                      <Button 
                            size="xs"
                        colorScheme="red" 
                            variant="outline"
                            onClick={() => handleDeleteCoupon(coupon._id)}
                            isLoading={deleteCouponLoadingId === coupon._id}
                      >
                            Delete
                      </Button>
                        </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
          </CardBody>
        </Card>

        {/* Feature Access Matrix */}
        <Card boxShadow="lg" borderRadius="lg" mt={4}>
          <CardHeader pb={0}>
            <Flex justify="space-between" align="center">
              <HStack>
                <Icon as={FaShieldAlt} color="purple.500" />
                <Heading size="md" color={headingColor}>Feature Access Control</Heading>
              </HStack>
              {featureMatrixDirty && (
                <Button
                  colorScheme="green"
                  size="sm"
                  onClick={handleSaveFeatureMatrix}
                  isLoading={featureMatrixLoading}
                >
                  Save Changes
                </Button>
              )}
            </Flex>
            <Text fontSize="sm" color={textColor} mt={1}>
              Control which features are available for each user tier. Toggle switches to enable/disable.
            </Text>
          </CardHeader>
          <CardBody>
            <TableContainer>
              <Table size="sm" variant="simple">
                <Thead>
                  <Tr bg={tableHeaderBg}>
                    <Th fontWeight="bold" minW="200px">Feature</Th>
                    <Th fontWeight="bold" textAlign="center" color="gray.500">
                      <VStack spacing={0}>
                        <Text>Basic</Text>
                        <Badge colorScheme="gray" fontSize="2xs">Free Tier</Badge>
                      </VStack>
                    </Th>
                    <Th fontWeight="bold" textAlign="center" color="blue.500">
                      <VStack spacing={0}>
                        <Text>Pro</Text>
                        <Badge colorScheme="blue" fontSize="2xs">Paid</Badge>
                      </VStack>
                    </Th>
                    <Th fontWeight="bold" textAlign="center" color="yellow.600">
                      <VStack spacing={0}>
                        <Text>Premium</Text>
                        <Badge colorScheme="yellow" fontSize="2xs">Full Access</Badge>
                      </VStack>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {featureMatrix.map((feature, idx) => (
                    <Tr key={feature.featureKey} _hover={{ bg: tableRowHover }}>
                      <Td>
                        <VStack align="start" spacing={0}>
                          <Text fontWeight="medium" fontSize="sm">{feature.featureLabel}</Text>
                          <Text fontSize="xs" color="gray.500">{feature.description}</Text>
                          <Badge size="xs" colorScheme="purple" fontSize="2xs" mt={1}>{feature.category}</Badge>
                        </VStack>
                      </Td>
                      {['basic', 'pro', 'premium'].map(tier => (
                        <Td key={tier} textAlign="center">
                          <VStack spacing={1}>
                            <Switch
                              size="md"
                              isChecked={feature[tier]?.enabled || false}
                              onChange={(e) => handleFeatureToggle(idx, tier, 'enabled', e.target.checked)}
                              colorScheme={tier === 'basic' ? 'gray' : tier === 'pro' ? 'blue' : 'yellow'}
                            />
                            {feature[tier]?.enabled && (
                              <Tooltip label="Daily limit (empty = unlimited)" placement="top">
                                <Input
                                  size="xs"
                                  type="number"
                                  placeholder="∞"
                                  value={feature[tier]?.limit ?? ''}
                                  onChange={(e) => handleFeatureToggle(idx, tier, 'limit', e.target.value ? Number(e.target.value) : null)}
                                  w="60px"
                                  textAlign="center"
                                />
                              </Tooltip>
                            )}
                          </VStack>
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </CardBody>
        </Card>

        {/* Template Design Management */}
        <Card boxShadow="lg" borderRadius="lg" mt={4}>
          <CardHeader pb={0}>
            <Flex justify="space-between" align="center">
              <HStack>
                <Icon as={FaPalette} color="teal.500" />
                <Heading size="md" color={headingColor}>Template Designs</Heading>
              </HStack>
              <Button
                colorScheme="teal"
                size="sm"
                leftIcon={<FiPlus />}
                onClick={() => openDesignModal(null)}
              >
                Add Design
              </Button>
            </Flex>
            <Text fontSize="sm" color={textColor} mt={1}>
              Manage document design templates. Users select from these during document generation.
            </Text>
          </CardHeader>
          <CardBody>
            <TableContainer>
              <Table size="sm" variant="striped" colorScheme="gray">
                <Thead>
                  <Tr>
                    <Th fontWeight="bold">Design Name</Th>
                    <Th fontWeight="bold">Categories</Th>
                    <Th fontWeight="bold">Font</Th>
                    <Th fontWeight="bold">Status</Th>
                    <Th fontWeight="bold">Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {templateDesigns.length === 0 ? (
                    <Tr><Td colSpan={5} textAlign="center">No template designs yet. Click "Add Design" to create one.</Td></Tr>
                  ) : templateDesigns.map(design => (
                    <Tr key={design._id} _hover={{ bg: tableRowHover }}>
                      <Td>
                        <VStack align="start" spacing={0}>
                          <Text fontWeight="medium">{design.name}</Text>
                          {design.description && <Text fontSize="xs" color="gray.500">{design.description}</Text>}
                        </VStack>
                      </Td>
                      <Td>
                        {design.isUniversal ? (
                          <Badge colorScheme="purple">All Categories</Badge>
                        ) : (
                          <Wrap spacing={1}>
                            {(design.categories || []).slice(0, 3).map(cat => (
                              <WrapItem key={cat}><Badge colorScheme="blue" fontSize="2xs">{cat}</Badge></WrapItem>
                            ))}
                            {(design.categories || []).length > 3 && (
                              <WrapItem><Badge colorScheme="gray" fontSize="2xs">+{design.categories.length - 3}</Badge></WrapItem>
                            )}
                          </Wrap>
                        )}
                      </Td>
                      <Td>
                        <Text fontSize="sm">{design.config?.fontFamily || 'Times New Roman'} {design.config?.fontSize || 12}pt</Text>
                      </Td>
                      <Td>
                        <HStack spacing={1}>
                          <Badge colorScheme={design.isActive !== false ? 'green' : 'red'}>
                            {design.isActive !== false ? 'Active' : 'Inactive'}
                          </Badge>
                          {design.isDefault && <Badge colorScheme="yellow">Default</Badge>}
                        </HStack>
                      </Td>
                      <Td>
                        <HStack spacing={1}>
                          <IconButton
                            size="xs"
                            icon={<FiEdit />}
                            colorScheme="blue"
                            variant="outline"
                            onClick={() => openDesignModal(design)}
                            aria-label="Edit design"
                          />
                          <IconButton
                            size="xs"
                            icon={<FiTrash2 />}
                            colorScheme="red"
                            variant="outline"
                            onClick={() => handleDeleteDesign(design._id)}
                            aria-label="Delete design"
                          />
                        </HStack>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </CardBody>
        </Card>
      </VStack>

      {/* Template Design Modal */}
      <DesignCreatorModal
        isOpen={isDesignModalOpen}
        onClose={() => setIsDesignModalOpen(false)}
        editingDesign={editingDesign}
        designForm={designForm}
        setDesignForm={setDesignForm}
        onSave={handleSaveDesign}
        onFileUpload={handleFileUpload}
        isAnalyzing={isAnalyzing}
        isSaving={templateDesignLoading}
        templateCategories={templateCategories}
      />

      {/* Create Coupon Modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Create New Coupon</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel>Coupon Code</FormLabel>
                <Input
                  value={newCoupon.code}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, code: e.target.value.toUpperCase() })
                  }
                  placeholder="Enter coupon code"
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Discount Percentage</FormLabel>
                <NumberInput
                  min={1}
                  max={100}
                  value={newCoupon.discountPercentage}
                  onChange={(value) =>
                    setNewCoupon({ ...newCoupon, discountPercentage: Number(value) })
                  }
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Maximum Uses</FormLabel>
                <NumberInput
                  min={1}
                  value={newCoupon.maxUses}
                  onChange={(value) =>
                    setNewCoupon({ ...newCoupon, maxUses: Number(value) })
                  }
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Valid From</FormLabel>
                <Input
                  type="date"
                  value={newCoupon.validFrom}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, validFrom: e.target.value })
                  }
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Valid Until</FormLabel>
                <Input
                  type="date"
                  value={newCoupon.validUntil}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, validUntil: e.target.value })
                  }
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleCreateCoupon}
              isLoading={isCreatingCoupon}
            >
              Create
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit Coupon Modal */}
      <Modal isOpen={isEditingCoupon} onClose={() => setIsEditingCoupon(false)}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit Coupon</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {editingCoupon && (
              <form onSubmit={handleEditCouponSubmit}>
                <VStack spacing={4} pb={4}>
                  <FormControl isRequired>
                    <FormLabel>Coupon Code</FormLabel>
                    <Input
                      value={editingCoupon.code}
                      onChange={e => setEditingCoupon({ ...editingCoupon, code: e.target.value })}
                    />
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel>Discount (%)</FormLabel>
                    <NumberInput
                      value={editingCoupon.discountPercentage}
                      onChange={value => setEditingCoupon({ ...editingCoupon, discountPercentage: Number(value) })}
                      min={0}
                      max={100}
                    >
                      <NumberInputField />
                      <NumberInputStepper>
                        <NumberIncrementStepper />
                        <NumberDecrementStepper />
                      </NumberInputStepper>
                    </NumberInput>
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel>Max Uses</FormLabel>
                    <NumberInput
                      value={editingCoupon.maxUses}
                      onChange={value => setEditingCoupon({ ...editingCoupon, maxUses: Number(value) })}
                      min={1}
                    >
                      <NumberInputField />
                      <NumberInputStepper>
                        <NumberIncrementStepper />
                        <NumberDecrementStepper />
                      </NumberInputStepper>
                    </NumberInput>
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel>Valid From</FormLabel>
                    <Input
                      type="date"
                      value={editingCoupon.validFrom ? new Date(editingCoupon.validFrom).toISOString().split('T')[0] : ''}
                      onChange={e => setEditingCoupon({ ...editingCoupon, validFrom: e.target.value })}
                    />
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel>Valid Until</FormLabel>
                    <Input
                      type="date"
                      value={editingCoupon.validUntil ? new Date(editingCoupon.validUntil).toISOString().split('T')[0] : ''}
                      onChange={e => setEditingCoupon({ ...editingCoupon, validUntil: e.target.value })}
                    />
                  </FormControl>
                  <Button type="submit" colorScheme="blue" width="full" isLoading={editCouponLoading}>
                    Save Changes
                  </Button>
                </VStack>
              </form>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </Container>
  );
};

export default AdminDashboard;
