import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Container,
  VStack,
  HStack,
  Input,
  Button,
  useToast,
  useColorModeValue,
  Text,
  IconButton,
  Heading,
  Flex,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Avatar,
  Spinner,
  Code,
  useColorMode,
  Tag,
  TagLabel,
  TagCloseButton
} from '@chakra-ui/react';
import { ArrowBackIcon, SettingsIcon, DeleteIcon, MoonIcon, SunIcon, AttachmentIcon } from '@chakra-ui/icons';
import ReactMarkdown from 'react-markdown';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import Profile from './Profile';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';

const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'image/jpeg',
  'image/png'
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const Chat = () => {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { colorMode, toggleColorMode } = useColorMode();
  
  // Updated color scheme for better dark mode
  const bgColor = useColorModeValue('gray.50', '#1a1b26');
  const containerBg = useColorModeValue('white', '#24283b');
  const borderColor = useColorModeValue('gray.200', '#414868');
  const textColor = useColorModeValue('gray.800', '#a9b1d6');
  const inputBgColor = useColorModeValue('white', '#1a1b26');
  const messageBgColor = useColorModeValue('blue.50', '#2f3549');
  const aiMessageBgColor = useColorModeValue('gray.100', '#1f2335');
  const codeBgColor = useColorModeValue('gray.50', '#1a1b26');
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const fetchChatHistory = async () => {
      try {
        const response = await axios.get('/api/chat/history', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setMessages(response.data);
      } catch (error) {
        console.error('Error fetching chat history:', error);
      }
    };

    fetchChatHistory();
  }, [token]);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        toast({
          title: 'Invalid File Type',
          description: 'Please upload a PDF, DOCX, JPEG, or PNG file.',
          status: 'error',
          duration: 3000,
        });
        setSelectedFile(null);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: 'File Too Large',
          description: `File size cannot exceed ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
          status: 'error',
          duration: 3000,
        });
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
    }
    // Reset the input value so the same file can be selected again if needed
    event.target.value = null; 
  };

  const handleSendMessage = async () => {
    if (!input.trim() && !selectedFile) return;

    setLoading(true);
    const userMessage = input;
    const currentFile = selectedFile;
    
    // Add user message immediately (even if only a file is sent)
    // You might want to display the file differently in the chat history
    const displayContent = userMessage + (currentFile ? ` (Attached: ${currentFile.name})` : '');
    if (displayContent.trim()) {
      setMessages(prev => [...prev, { role: 'user', content: displayContent }]);
    }

    setInput('');
    setSelectedFile(null);

    const formData = new FormData();
    formData.append('message', userMessage);
    if (currentFile) {
      formData.append('file', currentFile);
    }

    try {
      const response = await axios.post(
        '/api/chat/message',
        formData, // Send FormData
        { 
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data' // Important for file uploads
          }
        }
      );

      // Add AI response (include file/document payload so UI can render download link)
      const aiMessage = {
        role: 'assistant',
        content: response.data.response
      };

      if (response.data.mode) aiMessage.mode = response.data.mode;
      if (response.data.file) aiMessage.file = response.data.file;
      if (response.data.document) aiMessage.document = response.data.document;

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      // Add back the message/file if sending failed
      setInput(userMessage);
      setSelectedFile(currentFile);
      setMessages(prev => prev.slice(0, -1)); // Remove the optimistically added message
      
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Error sending message/file',
        status: 'error',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = async () => {
    setSelectedFile(null); // Clear selected file as well
    try {
      await axios.delete('/api/chat/clear', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages([]);
      toast({
        title: 'Chat Cleared',
        status: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('Error clearing chat:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Error clearing chat',
        status: 'error',
        duration: 3000,
      });
    }
  };

  const renderMessageContent = (content, role) => {
    // Simple check if content looks like code (you might need a more robust check)
    const codeBlockRegex = /```(?:\w+\n)?([\s\S]*?)```/g;
    const isCode = codeBlockRegex.test(content) || /^(import|const|let|var|function|class|#include|int|public|def|from|package|using|\/\/|#)/.test(content.trim());
    
    if (isCode) {
      // Extract code content if wrapped in triple backticks
      const match = content.match(codeBlockRegex);
      let codeContent = content;
      let language = 'plaintext'; // Default language
      
      if (match) {
        // Try to extract language hint (e.g., ```python)
        const languageMatch = content.match(/```(\w+)\n/);
        if (languageMatch && languageMatch[1]) {
          language = languageMatch[1];
        }
        codeContent = match[0].replace(/```(?:\w+\n)?|```/g, '').trim();
      } else {
        // Basic language detection if not wrapped in backticks
        if (content.includes('#include')) language = 'cpp';
        else if (content.includes('public class')) language = 'java';
        else if (content.includes('def ') || content.includes('import ')) language = 'python';
        else if (content.includes('function') || content.includes('const') || content.includes('let') || content.includes('var')) language = 'javascript';
      }

      return (
        <Box width="100%" overflowX="auto">
          <SyntaxHighlighter
            language={language}
            style={colorMode === 'dark' ? vscDarkPlus : vs}
            customStyle={{
              margin: 0,
              padding: '1em',
              borderRadius: '0.5rem',
              background: codeBgColor,
              whiteSpace: 'pre-wrap', // Ensure wrapping within the highlighter
              wordBreak: 'break-all' // Break long words/lines
            }}
            wrapLines={true} // Enable line wrapping
            wrapLongLines={true}
          >
            {codeContent}
          </SyntaxHighlighter>
        </Box>
      );
    }

    return (
      <Box
        fontSize="md"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        color={textColor}
      >
        <ReactMarkdown
          components={{
            strong: ({ children }) => (
              <Text as="span" fontWeight="bold" color={useColorModeValue('blue.700', 'blue.200')}>
                {children}
              </Text>
            ),
            p: ({ children }) => (
              <Text mb={2} lineHeight="1.6">
                {children}
              </Text>
            ),
            ul: ({ children }) => (
              <Box as="ul" pl={4} mb={2}>
                {children}
              </Box>
            ),
            ol: ({ children }) => (
              <Box as="ol" pl={4} mb={2}>
                {children}
              </Box>
            ),
            li: ({ children }) => (
              <Text as="li" mb={1}>
                {children}
              </Text>
            ),
            code: ({ children }) => (
              <Code px={1} borderRadius="sm" fontSize="sm">
                {children}
              </Code>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </Box>
    );
  };

  return (
    <Box minH="100vh" bg={bgColor} position="relative">
      {/* Header */}
      <Box 
        w="full" 
        bg={containerBg} 
        borderBottomWidth={1} 
        borderColor={borderColor}
        position="fixed"
        top={0}
        zIndex={10}
        px={4}
        py={3}
        shadow="sm"
      >
        <Container maxW="container.lg">
          <Flex align="center" justify="space-between">
            <HStack spacing={4}>
              <IconButton
                icon={<ArrowBackIcon />}
                onClick={() => navigate('/')}
                variant="ghost"
                aria-label="Back"
                size="md"
                color={textColor}
              />
              <Heading size="md" color={textColor}>Law AI Chat</Heading>
            </HStack>
            
            <HStack spacing={3}>
              <Text fontSize="sm" color={textColor}>
                {user?.email}
              </Text>
              <IconButton
                icon={colorMode === 'dark' ? <SunIcon /> : <MoonIcon />}
                onClick={toggleColorMode}
                variant="ghost"
                color={textColor}
                aria-label="Toggle color mode"
              />
              <IconButton
                icon={<SettingsIcon />}
                onClick={onOpen}
                variant="ghost"
                aria-label="Settings"
                color={textColor}
              />
              <Button
                onClick={logout}
                size="sm"
                colorScheme="red"
                variant="ghost"
              >
                Logout
              </Button>
            </HStack>
          </Flex>
        </Container>
      </Box>

      {/* Main Chat Area */}
      <Box 
        pt="72px"
        pb={selectedFile ? "120px" : "80px"} // Increase padding when file is selected
        height="100vh"
        overflowY="hidden"
        transition="padding-bottom 0.2s ease-in-out"
      >
        <Container 
          maxW="container.md" 
          h="full" 
          py={4}
          display="flex"
          flexDirection="column"
        >
          {/* Messages Container */}
          <Box 
            flex="1"
            overflowY="auto"
            borderRadius="lg"
            bg={containerBg}
            borderWidth={1}
            borderColor={borderColor}
            p={4}
            ref={chatContainerRef}
            sx={{
              '&::-webkit-scrollbar': {
                width: '4px',
              },
              '&::-webkit-scrollbar-track': {
                width: '6px',
              },
              '&::-webkit-scrollbar-thumb': {
                background: borderColor,
                borderRadius: '24px',
              },
            }}
          >
            <VStack spacing={6} align="stretch">
              {messages.map((message, index) => (
                <Box
                  key={index}
                  alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'}
                  maxW={{ base: "90%", md: "80%" }}
                >
                  <HStack spacing={3} align="flex-start">
                    {message.role === 'assistant' && (
                      <Avatar
                        size="sm"
                        name="Law AI"
                        src="/law-ai-avatar.png"
                        bg="blue.500"
                      />
                    )}
                    <Box
                      p={4}
                      borderRadius="lg"
                      bg={message.role === 'user' ? messageBgColor : aiMessageBgColor}
                      shadow="sm"
                      width="100%"
                    >
                      {renderMessageContent(message.content, message.role)}

                      {message.role === 'assistant' && message.document && (
                        <Box mt={3} p={3} bg={codeBgColor} borderRadius="md">
                          <Text fontSize="sm" fontWeight="600">{message.document.displayTitle}</Text>
                          <Text fontSize="sm" mt={2} color={textColor} whiteSpace="pre-wrap">{message.document.preview}</Text>
                          <HStack mt={3} spacing={3}>
                            {message.file && (
                              <Button
                                as="a"
                                href={message.file.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                colorScheme="blue"
                                size="sm"
                              >
                                Download
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => {
                              // If there's a document download URL but no file, still open the download
                              const url = message.file?.fileUrl || message.document?.downloadUrl;
                              if (url) window.open(url, '_blank', 'noopener');
                            }}>Open</Button>
                          </HStack>
                        </Box>
                      )}
                    </Box>
                    {message.role === 'user' && (
                      <Avatar
                        size="sm"
                        name={user?.firstName + ' ' + user?.lastName}
                        src={user?.profileImage}
                      />
                    )}
                  </HStack>
                </Box>
              ))}
              {loading && (
                <Box alignSelf="flex-start">
                  <HStack spacing={3}>
                    <Avatar
                      size="sm"
                      name="Law AI"
                      src="/law-ai-avatar.png"
                      bg="blue.500"
                    />
                    <Box
                      p={4}
                      borderRadius="lg"
                      bg={aiMessageBgColor}
                    >
                      <Spinner size="sm" color="blue.500" />
                    </Box>
                  </HStack>
                </Box>
              )}
              <div ref={messagesEndRef} />
            </VStack>
          </Box>
        </Container>
      </Box>

      {/* Input Area - Updated */}
      <Box 
        position="fixed"
        bottom={0}
        left={0}
        right={0}
        bg={containerBg}
        borderTopWidth={1}
        borderColor={borderColor}
        px={4}
        py={3}
        shadow="lg"
      >
        <Container maxW="container.md">
          {/* Display selected file */}
          {selectedFile && (
            <Box mb={2}>
              <Tag size="lg" variant="subtle" colorScheme="blue">
                <TagLabel maxW="calc(100% - 50px)" isTruncated>{selectedFile.name}</TagLabel>
                <TagCloseButton onClick={() => setSelectedFile(null)} />
              </Tag>
            </Box>
          )}
          <HStack spacing={3} align="center">
            {/* Hidden File Input */}
            <Input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.docx,.jpg,.jpeg,.png"
              style={{ display: 'none' }}
              id="file-upload-input"
            />
            {/* Attachment Button */}
            <IconButton
              icon={<AttachmentIcon />}
              onClick={() => fileInputRef.current?.click()}
              variant="ghost"
              color={textColor}
              aria-label="Attach file"
              isDisabled={loading}
              size="md"
            />
            {/* Text Input */}
            <Input
              flex="1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message or attach a file..."
              bg={inputBgColor}
              color={textColor}
              size="md"
              borderRadius="md"
              isDisabled={loading}
              _focus={{
                borderColor: 'blue.500',
                boxShadow: 'none'
              }}
            />
            {/* Send Button */}
            <Button
              onClick={handleSendMessage}
              colorScheme="blue"
              isLoading={loading}
              isDisabled={!input.trim() && !selectedFile}
              px={6}
              size="md"
            >
              Send
            </Button>
            {/* Clear Button */}
            <IconButton
              icon={<DeleteIcon />}
              onClick={clearChat}
              variant="ghost"
              colorScheme="red"
              aria-label="Clear chat"
              isDisabled={loading}
              size="md"
            />
          </HStack>
        </Container>
      </Box>

      {/* Profile Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="xl">
        <ModalOverlay />
        <ModalContent bg={containerBg}>
          <ModalHeader color={textColor}>Profile Settings</ModalHeader>
          <ModalCloseButton color={textColor} />
          <ModalBody>
            <Profile />
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default Chat; 