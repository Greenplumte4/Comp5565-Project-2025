// File: ProductRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 引入 OpenZeppelin 的 ERC721 标准实现。
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; 
// 引入自定义接口。
import "./I_Interfaces.sol";

// ProductRegistry 合约：作为产品 NFT 的发行者和数据记录中心。
contract ProductRegistry is ERC721, IProductRegistry, Ownable { 

    // 外部合约引用：允许 Marketplace 调用受限功能。
    address public marketplaceContract;
    // 外部合约引用：用于查询地址是否拥有制造商/零售商等业务角色。
    IRolesContract public rolesContract;
    // 外部合约引用：用于查询产品保修状态。
    IWarrantyManager public warrantyManager;
    
    // 下一个要铸造的 Token ID，从 1000 开始。
    uint256 private _nextTokenId = 1000;
    
    // 新增: 将产品的序列号映射到其对应的 Token ID。
    mapping(string => uint256) public serialNumberToTokenId; 

    // --- 结构体定义 ---
    struct ProductStaticData {
        string serialNumber;        // 产品的唯一序列号。
        string modelDetails;        // 产品型号详情。
        string manufacturerDetails; // 制造商名称。
        string warrantyTermsURI;    // 保修条款的 URI。
        uint256 timeStamp;          // 注册（铸造）时间戳。
    }
    struct MarketData {
        uint256 price;              // 当前市场价格。
        bool isListed;              // 是否在市场上架。
    }
    struct TransferLog {
        address from;                // 转移自。
        address to;                  // 转移给。
        uint256 timestamp;           // 转移时间戳。
        string eventType;            // 转移类型（如: DISTRIBUTION, RETAIL_SALE, RESALE）。
    }
    
    // 用于 verifyProduct 函数返回所有信息的聚合结构体
    struct ProductVerificationData { 
        // 静态数据
        uint256 tokenId;
        string serialNumber;
        string modelDetails;
        string manufacturerDetails;
        uint256 registrationTimestamp;
        
        // 市场信息
        uint256 currentPrice;
        bool isListed;
        
        // 所有权信息
        address currentOwner;
        TransferLog[] ownershipHistory;
    }
    
    // --- 核心数据存储 (映射) ---
    mapping(uint256 => ProductStaticData) public staticData;
    mapping(uint256 => MarketData) public marketInfo;
    mapping(uint256 => TransferLog[]) public ownershipHistory;

    // --- 权限管理修饰符 ---
    modifier onlyMarketplace() {
        require(msg.sender == marketplaceContract, "Registry: Only Marketplace can call.");
        _;
    }

    // --- 构造函数 ---
    constructor(
        address _rolesContract,
        address _warrantyManager
    ) ERC721("ProductNFT", "PRD") Ownable(msg.sender) {
        require(_rolesContract != address(0) && _warrantyManager != address(0), "PR: Invalid address.");
        rolesContract = IRolesContract(_rolesContract);
        warrantyManager = IWarrantyManager(_warrantyManager);
    }

    // --- Admin/Setup Functions ---
    function setMarketplaceAddress(address _marketplaceAddress) external onlyOwner override { 
        require(marketplaceContract == address(0), "Registry: Marketplace already set.");
        require(_marketplaceAddress != address(0), "Registry: Invalid address.");
        
        marketplaceContract = _marketplaceAddress;

        _setApprovalForAll(owner(), _marketplaceAddress, true);
    }
    function setRolesContract(address _rolesContract) external onlyOwner {
        rolesContract = IRolesContract(_rolesContract);
    }
    function setWarrantyManager(address _warrantyManager) external onlyOwner {
        warrantyManager = IWarrantyManager(_warrantyManager);
    }

    // --- 核心业务功能 ---
    
    // recordOwnershipTransfer：记录产品所有权转移的业务事件。
    // 改为 public，允许合约内部 (mintProduct) 直接调用，也允许外部 Marketplace 调用。
    function recordOwnershipTransfer(
        uint256 productId, 
        address from, 
        address to, 
        string memory eventType 
    ) public onlyMarketplace override {
        ownershipHistory[productId].push(TransferLog({
            from: from,
            to: to,
            timestamp: block.timestamp,
            eventType: eventType
        }));
    }

    // mintProduct：铸造新的产品 NFT。
    function mintProduct(
        address to, 
        string memory serialNumber, 
        string memory modelDetails, 
        string memory manufacturerDetails, 
        uint256 price, 
        string memory warrantyTermsURI 
    ) external onlyMarketplace override returns (uint256 tokenId) {
        
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        
        // 记录 serialNumber 到 tokenId 的映射
        serialNumberToTokenId[serialNumber] = tokenId; 
        
        staticData[tokenId] = ProductStaticData({
            serialNumber: serialNumber,
            modelDetails: modelDetails,
            manufacturerDetails: manufacturerDetails,
            warrantyTermsURI: warrantyTermsURI,
            timeStamp: block.timestamp
        });
        marketInfo[tokenId].price = price;
        marketInfo[tokenId].isListed = true;
        
        // 记录首次铸造事件
        recordOwnershipTransfer(tokenId, address(0), to, "MINT_DISTRIBUTION"); 
        
        return tokenId;
    }

    // updateMarketInfo：更新产品的价格和上架状态。
    function updateMarketInfo(uint256 productId, uint256 price, bool isListed) external onlyMarketplace override {
        marketInfo[productId].price = price;
        marketInfo[productId].isListed = isListed;
    }

    // ------------------------------------------------------------
    // 消费者真伪验证功能 (Consumer Authenticity Verification)
    // ------------------------------------------------------------
    
    // 辅助查询：通过序列号获取 Token ID。
    function getTokenIdBySerialNumber(string memory _serialNumber) 
        public 
        view 
        returns (uint256) 
    {
        return serialNumberToTokenId[_serialNumber];
    }
    
    // 核心验证接口：通过 Token ID 返回产品所有关键信息。
    function verifyProduct(uint256 _tokenId) 
        public 
        view 
        returns (ProductVerificationData memory data) 
    {
        // 使用 ownerOf 替代 _exists (适配 OpenZeppelin v5)
        // 如果代币不存在，ownerOf 会 revert (ERC721标准行为)，此处使用 try-catch 只是为了更好的错误提示
        try this.ownerOf(_tokenId) returns (address _owner) {
             require(_owner != address(0), "PR: Product ID does not exist on chain.");
        } catch {
             revert("PR: Product ID does not exist on chain.");
        }

        // 2. 检索所有数据
        ProductStaticData memory staticD = staticData[_tokenId];
        MarketData memory marketD = marketInfo[_tokenId];
        TransferLog[] memory history = ownershipHistory[_tokenId];
        address owner = ownerOf(_tokenId);

        // 3. 填充并返回聚合结构体
        data = ProductVerificationData({
            tokenId: _tokenId,
            serialNumber: staticD.serialNumber,
            modelDetails: staticD.modelDetails,
            manufacturerDetails: staticD.manufacturerDetails,
            registrationTimestamp: staticD.timeStamp,
            
            currentPrice: marketD.price,
            isListed: marketD.isListed,
            
            currentOwner: owner,
            ownershipHistory: history
        });
        
        return data;
    }

    // --- ERC721 标准函数重写与业务逻辑 ---

    // ownerOf：查询产品 NFT 的所有者。
    function ownerOf(uint256 tokenId) public view override(ERC721, IProductRegistry) returns (address) {
        return super.ownerOf(tokenId);
    }

    // transferFrom：重写标准转账函数，用于限制客户间转账。
    // 修复: 添加 IProductRegistry 到 override 列表
    function transferFrom(address from, address to, uint256 tokenId) public override(ERC721, IProductRegistry) {
        require(_isApprovedOrOwner(msg.sender, tokenId), "ERC721: caller is not token owner or approved");
        
        if (rolesContract.hasAnyRole(from) || rolesContract.hasAnyRole(to)) {
            super.transferFrom(from, to, tokenId);
        } else {
            revert("ERC721: Use restrictedTransferFrom for non-role accounts.");
        }
    }

    // safeTransferFrom：重写标准安全转账函数，逻辑与 transferFrom 类似。
    // 注意：仅重写带 data 参数的版本。OpenZeppelin v5 中不带 data 的版本非 virtual，不可重写。
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public override(ERC721) {
        require(_isApprovedOrOwner(msg.sender, tokenId), "ERC721: caller is not token owner or approved");
        
        if (rolesContract.hasAnyRole(from) || rolesContract.hasAnyRole(to)) {
            super.safeTransferFrom(from, to, tokenId, data);
        } else {
            revert("ERC721: Use restrictedTransferFrom for non-role accounts.");
        }
    }
    
    // 修复: 删除了 safeTransferFrom(address,address,uint256) 的重载版本
    // 因为 OpenZeppelin v5 中该函数不是 virtual 的，无法重写。
    // 它内部会自动调用上面那个带 data 的版本，所以我们的逻辑依然有效。

    // restrictedTransferFrom：用于客户间的自定义转账函数。
    function restrictedTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        require(
            _isApprovedOrOwner(msg.sender, tokenId),
            "ERC721: caller is not token owner or approved"
        );
        
        // 客户间转账 (C -> C') 限制已移除
        _transfer(from, to, tokenId);
    }

    // _isApprovedOrOwner：辅助函数，封装 OpenZeppelin 内部的权限检查逻辑。
    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        // 检查是否为所有者
        if (ownerOf(tokenId) == spender) {
            return true;
        }
        // 检查是否为 Marketplace 合约 (Marketplace是操作者)
        if (spender == marketplaceContract) {
            return true;
        }
        // 检查是否被批准
        return super.getApproved(tokenId) == spender || isApprovedForAll(ownerOf(tokenId), spender);
    }
}