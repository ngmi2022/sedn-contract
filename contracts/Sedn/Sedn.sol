// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

// TODO: shouldnt have console.log in production
import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
//TODO: why do we need SafeMath?
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "../Forwarder/SednForwarder.sol";

//TODO: is this used?
error SednError();

interface IUserRequest {
    /**
    // @param id route id of middleware to be used
    // @param optionalNativeAmount is the amount of native asset that the route requires 
    // @param inputToken token address which will be swapped to
    // BridgeRequest inputToken 
    // @param data to be used by middleware
    */
    struct MiddlewareRequest {
        uint256 id;
        uint256 optionalNativeAmount;
        address inputToken;
        bytes data;
    }

    /**
    // @param id route id of bridge to be used
    // @param optionalNativeAmount optinal native amount, to be used
    // when bridge needs native token along with ERC20    
    // @param inputToken token addresss which will be bridged 
    // @param data bridgeData to be used by bridge
    */
    struct BridgeRequest {
        uint256 id;
        uint256 optionalNativeAmount;
        address inputToken;
        bytes data;
    }

    /**
    // @param receiverAddress Recipient address to recieve funds on destination chain
    // @param toChainId Destination ChainId
    // @param amount amount to be swapped if middlewareId is 0  it will be
    // the amount to be bridged
    // @param middlewareRequest middleware Requestdata
    // @param bridgeRequest bridge request data
    */
    struct UserRequest {
        address receiverAddress;
        uint256 toChainId;
        uint256 amount;
        MiddlewareRequest middlewareRequest;
        BridgeRequest bridgeRequest;
    }
}

interface IRegistry is IUserRequest {
    function outboundTransferTo(UserRequest calldata _userRequest) external payable;
}

/// @title Contract to enhance USDC functionality by letting users send money to a "claimable" payment balance
/// @author Marco Hauptmann, Derek Rein & Ferdinand Ehrhardt
/// @notice This contract is not production-ready and should not be used in production
contract Sedn is ERC20, ERC2771Context, Ownable, IUserRequest {
    IERC20 public immutable usdcToken;
    IRegistry public immutable registry;
    uint256 public paymentCounter;
    address public addressDelegate;
    address public trustedVerifyAddress;
    uint256 public nonce = 0;
    //TODO: Why extra 20 seconds?
    uint256 public timeToUnlock = 20;

    event TransferKnown(address indexed from, address indexed to, uint256 amount);
    event TransferUnknown(address indexed from, bytes32 secret, uint256 amount);
    event TransferUnknownToExistingSecret(address indexed from, bytes32 secret, uint256 amountIncreased);
    event SednKnown(address indexed from, address indexed to, uint256 amount);
    event SednUnknown(address indexed from, bytes32 secret, uint256 amount);
    event SednUnknownToExistingSecret(address indexed from, bytes32 secret, uint256 amountIncreased);
    event HybridKnown(address indexed from, address indexed to, uint256 amount);
    event HybridUnknown(address indexed from, bytes32 secret, uint256 amount);
    event HybridUnknownToExistingSecret(address indexed from, bytes32 secret, uint256 amountIncreased);
    event PaymentClaimed(address indexed recipient, bytes32 secret, uint256 amount);
    event Withdraw(address indexed owner, address indexed to, uint256 amount);
    event BridgeWithdraw(address indexed owner, address indexed to, uint256 amount, uint256 chainId);
    event Clawback(address indexed recipient, bytes32 secret, uint256 amount);

    mapping(bytes32 => uint256) private _payments;
    mapping(bytes32 => uint256) private _senderPayments;

    /**
     * @param _usdcTokenAddressForChain Address for the USDC implementation for chain
     * @param _registryDeploymentAddressForChain Address for the registry (Socket) implementation for chain
     * @param _trustedVerifyAddress Address acting as verifier to unlock valid claims, not specific for chains
     * @param _trustedForwarder Address for the trusted forwarder contract for chain
     */
    constructor(
        address _usdcTokenAddressForChain,
        address _registryDeploymentAddressForChain,
        address _trustedVerifyAddress,
        SednForwarder _trustedForwarder
    )
        // TODO: `sdnUSDC` missing `e` in `Sedn`
        ERC2771Context(address(_trustedForwarder))
        ERC20("Sedn USDC", "sdnUSDC")
    {
        // TODO: shouldnt have console.log in production
        console.log(
            "Deploying the Sedn Contract; USDC Token Address: %s; Socket Registry: %s",
            _usdcTokenAddressForChain,
            _registryDeploymentAddressForChain
        );
        usdcToken = IERC20(_usdcTokenAddressForChain);
        registry = IRegistry(_registryDeploymentAddressForChain);
        trustedVerifyAddress = _trustedVerifyAddress;
    }

    ///@inheritdoc ERC2771Context
    function _msgSender() internal view virtual override(Context, ERC2771Context) returns (address sender) {
        sender = ERC2771Context._msgSender();
    }

    ///@inheritdoc ERC2771Context
    function _msgData() internal view virtual override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    /**
     * @dev See {ERC20-decimals}.
     * @notice Overriding decimals to return the decimals of USDC token, when in doubt return to 6
     */
    function decimals() public view virtual override returns (uint8) {
        try IERC20Metadata(address(usdcToken)).decimals() returns (uint8 value) {
            return value;
        } catch {
            return 6;
        }
    }

    /**
     * @param _amount Amount of USDC to be sent to unknown
     * @param from Address of the sender
     * @param secret Secret to identify the payment
     */
    function _addPayment(
        uint256 _amount,
        address from,
        bytes32 secret
    ) internal {
        _payments[secret] += _amount;
        bytes32 paymentHash = _combineToBytes32(from, secret, block.timestamp);
        _senderPayments[paymentHash] += _amount;
    }

    /**
     * @param _address Address of the sender
     * @param _secret Secret to identify the payment
     * @param timestamp Timestamp of block where the payment is executed
     * @dev Creates a unique key for the payment to enable clawbacks
     */
    function _combineToBytes32(
        address _address,
        bytes32 _secret,
        uint256 timestamp
    ) public pure returns (bytes32) {
        //TODO: no require for timestamp?
        //TODO: no require for _secret?
        bytes32 _addressBytes = keccak256(abi.encodePacked(_address));
        bytes32 _timestampBytes = keccak256(abi.encodePacked(timestamp));
        return keccak256(abi.encodePacked(_addressBytes, _secret, _timestampBytes));
    }

    /**
     * @param _amount The amount of USDC to be sent from EOA
     * @param secret New, unique secret to identify and claim the payment
     */
    function sednUnknown(uint256 _amount, bytes32 secret) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(usdcToken.transferFrom(_msgSender(), address(this), _amount), "Token transfer failed");
        _addPayment(_amount, _msgSender(), secret);
        emit SednUnknown(_msgSender(), secret, _amount);
    }

    /**
     * @param _amount The amount of USDC to be sent from EOA
     * @param to The address to send the USDC to
     */
    function sednKnown(uint256 _amount, address to) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(usdcToken.transferFrom(_msgSender(), address(this), _amount), "Transfer failed");
        _mint(to, _amount);
        emit SednKnown(_msgSender(), to, _amount);
    }

    /**
     * @param _amount The amount of USDC to be sent from sednBalance
     * @param secret Existing secret to identify and claim the payment
     */
    function transferUnknown(uint256 _amount, bytes32 secret) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(_msgSender() != address(0), "Transfer from the zero address");
        _burn(_msgSender(), _amount);
        _addPayment(_amount, _msgSender(), secret);
        emit TransferUnknown(_msgSender(), secret, _amount);
    }

    /**
     * @param _amount The amount of USDC to be sent from sednBalance
     * @param to The address to send the USDC to
     */
    function transferKnown(uint256 _amount, address to) external {
        //TODO: How can msgSender be address(0) ?
        require(_msgSender() != address(0), "Transfer from the zero address");
        require(to != address(0), "Transfer to the zero address");
        _transfer(_msgSender(), to, _amount);
        emit TransferKnown(_msgSender(), to, _amount);
    }

    /**
     * @param _amount The amount of USDC to be sent from EOA
     * @param balanceAmount The amount of USDC to be sent from sednBalance
     * @param secret Existing secret to identify and claim the payment
     */
    function hybridUnknown(
        uint256 _amount,
        uint256 balanceAmount,
        bytes32 secret
    ) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(balanceAmount > 0, "Amount must be greater than 0");
        uint256 totalAmount = _amount + balanceAmount;
        require(usdcToken.transferFrom(_msgSender(), address(this), _amount), "Transfer failed");
        _burn(_msgSender(), balanceAmount);
        _addPayment(totalAmount, _msgSender(), secret);
        emit HybridUnknown(_msgSender(), secret, totalAmount);
    }

    /**
     * @param _amount The amount of USDC to be sent from EOA
     * @param balanceAmount The amount of USDC to be sent from sednBalance
     * @param to The address to send the USDC to
     */
    function hybridKnown(
        uint256 _amount,
        uint256 balanceAmount,
        address to
    ) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(balanceAmount > 0, "Amount must be greater than 0");
        require(usdcToken.transferFrom(_msgSender(), address(this), _amount), "Transfer failed");
        _mint(to, _amount); // credit newly received funds (in contract)
        _transfer(_msgSender(), to, _amount); // transfer existing funds (in contract)
        uint256 totalAmount = _amount + balanceAmount;
        emit HybridKnown(_msgSender(), to, totalAmount);
    }

    /**
     * @param secret The secret to identify and clawback the payment
     */
    function clawback(bytes32 secret, uint256 timestamp) external {
        require(block.timestamp > (timestamp + timeToUnlock), "Clawback not allowed yet");
        //TODO: How are we saving the timestamp? since you need that to clawback
        bytes32 paymentHash = _combineToBytes32(_msgSender(), secret, timestamp);
        uint256 amount = _senderPayments[paymentHash];
        require(amount > 0, "No payment found");
        //TODO: So user gets SEDN USDC back?
        //TODO: you have to set the payments first to 0 otherwise you maybe can do a reentrancy attack
        _mint(_msgSender(), amount);
        _payments[secret] -= amount;
        _senderPayments[paymentHash] = 0;
        emit Clawback(_msgSender(), secret, amount);
    }

    /**
     * @param solution the solutio to the hashed secret
     * @param secret The secret to identify and claim the payment
     * @param receiver The address to send the USDC to
     * @param amount The amount of USDC to be claimed
     * @param till The time till the transaction is valid
     * @param _v The v value of the signature
     * @param _r The r value of the signature
     @ @param _s The s value of the signature
     */
    function _checkClaim(
        string memory solution,
        bytes32 secret,
        address receiver,
        uint256 amount,
        uint256 till,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal view {
        require(keccak256(abi.encodePacked(solution)) == secret, "Incorrect answer");
        require(_payments[secret] >= 0, "No secret carrying balance");
        require(block.timestamp < till, "Time expired");
        require(verify(amount, receiver, till, secret, nonce, _v, _r, _s), "Verification failed");
    }

    /**
     * @param solution the solutio to the hashed secret
     * @param secret The secret to identify and claim the payment
     * @param _till The time till the transaction is valid
     * @param _v The v value of the signature
     * @param _r The r value of the signature
     * @param _s The s value of the signature
     */
    function claim(
        string memory solution,
        bytes32 secret,
        uint256 _till,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        uint256 secretAmount = _payments[secret];
        _checkClaim(solution, secret, _msgSender(), secretAmount, _till, _v, _r, _s);
        require(_msgSender() != address(0), "Transfer to the zero address not possible");
        _mint(_msgSender(), secretAmount);
        _payments[secret] = 0;
        // TODO: we not need to set the clawback to zero too? This is a big funerability issue. You claim your cash but you can still clawback
        emit PaymentClaimed(_msgSender(), secret, secretAmount);
    }

    /**
     * @param amount The amount of USDC to be withdrawn
     * @param to The address to withdraw the USDC toss
     */
    function withdraw(uint256 amount, address to) external {
        require(_msgSender() != address(0), "Transfer from the zero address");
        usdcToken.approve(address(this), amount);
        require(usdcToken.transferFrom(address(this), to, amount), "transferFrom failed");
        _burn(_msgSender(), amount);
        emit Withdraw(_msgSender(), to, amount);
    }

    /**
     * @param amount The amount of USDC to be withdrawn
     * @param _userRequest The input data for the socket implementation, receiver is found here
     * @param bridgeImpl The address to give sufficient approvals to
     */
    function bridgeWithdraw(
        uint256 amount,
        UserRequest calldata _userRequest,
        address bridgeImpl
    ) external payable virtual {
        address to = _userRequest.receiverAddress;
        require(_msgSender() != address(0), "bridgeWithdrawal from the zero address");
        require(to != address(0), "bridgeWithdrawal to the zero address");
        //TODO: console.log production
        console.log("Bridge and claiming funds", amount, _msgSender());
        usdcToken.approve(address(registry), amount);
        usdcToken.approve(bridgeImpl, amount);
        registry.outboundTransferTo{ value: msg.value }(_userRequest);
        //TODO: not sure about this comment but dont we have to check amount before burning?
        _burn(_msgSender(), amount);
        emit BridgeWithdraw(_msgSender(), to, amount, _userRequest.toChainId);
    }

    /**
     * @notice This is an admin function
     * @param _trustedVerifyAddress The address of the trusted verifier
     */
    function setVerifier(address _trustedVerifyAddress) external onlyOwner {
        trustedVerifyAddress = _trustedVerifyAddress;
    }

    function increaseNonce() public onlyOwner {
        nonce++;
    }

    /**
     * @dev This function is internally used by _checkClaim to verify the signature
     * @param _amount The amount of USDC to be claimed
     * @param _receiver The address to send the USDC to
     * @param _till The time till the transaction is valid
     * @param _secret The secret to identify and claim the payment
     * @param _nonce The nonce to prevent replay attacks
     */
    function getMessageHash(
        uint256 _amount,
        address _receiver,
        uint256 _till,
        bytes32 _secret,
        uint256 _nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_amount, _receiver, _till, _secret, _nonce));
    }

    function getEthSignedMessageHash(bytes32 _messageHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _messageHash));
    }

    /**
     * @param secret the secret of the payment
     * @return amount returns the payment amount
     */
    function getPaymentAmount(bytes32 secret) public view returns (uint256) {
        uint256 amount = _payments[secret];
        return amount;
    }

    /**
     * @dev This function is internally used by _checkClaim to verify the signature
     * @param _amount The amount of USDC to be claimed
     * @param _receiver The address to send the USDC to
     * @param _till The time till the transaction is valid
     * @param _secret The secret to identify and claim the payment
     * @param _nonce The nonce to prevent replay attacks
     * @param _v The v value of the signature
     * @param _r The r value of the signature
     * @param _s The s value of the signature
     */
    function verify(
        uint256 _amount,
        address _receiver,
        uint256 _till,
        bytes32 _secret,
        uint256 _nonce,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) public view returns (bool) {
        bytes32 messageHash = getMessageHash(_amount, _receiver, _till, _secret, _nonce);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        address recoveredAddress = ecrecover(ethSignedMessageHash, _v, _r, _s);
        return recoveredAddress == trustedVerifyAddress;
    }
}
