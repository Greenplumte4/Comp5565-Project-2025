// File: ProductRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 引入 OpenZeppelin 的 ERC721 标准实现。
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // 新增: 引入 Ownable 权限管理
// 引入自定义接口。
import "./I_Interfaces.sol";

// ProductRegistry 合约：作为产品 NFT 的发行者和数据记录中心，继承 ERC721 标准和 IProductRegistry 接口。
contract ProductRegistry is ERC721, IProductRegistry, Ownable { // 继承 Ownable

    // 外部合约引用：允许 Marketplace 调用受限功能。
    address public marketplaceContract;
    // 外部合约引用：用于查询地址是否拥有制造商/零售商等业务角色。
    IRolesContract public rolesContract;
    // 外部合约引用：用于查询产品保修状态。
    IWarrantyManager public warrantyManager;
    
    // 下一个要铸造的 Token ID，从 1000 开始。
    uint256 private _nextTokenId = 1000;

    // --- 结构体定义 (未修改) ---
    struct ProductStaticData {
        string serialNumber;        
        string modelDetails;        
        string manufacturerDetails; 
        string warrantyTermsURI;    
        uint256 timeStamp;          
    }
    struct MarketData {
        uint256 price;              
        bool isListed;              
    }
    struct TransferLog {
        address from;               
        address to;                 
        uint256 timestamp;          
        string eventType;           
    }
    
    // --- 映射 (未修改) ---
    mapping(uint256 => ProductStaticData) public staticData;
    mapping(uint256 => MarketData) public marketInfo;
    mapping(uint256 => TransferLog[]) public ownershipHistory;

    // --- 修饰符 (未修改) ---
    // 限制只有授权的 Marketplace 合约才能调用。
    modifier onlyMarketplace() {
        require(msg.sender == marketplaceContract, "Registry: Only Marketplace can call.");
        _;
    }
    
    // --- 构造函数 ---
    constructor(
        address _rolesAddress,
        address _warrantyManagerAddress
    )
        ERC721("ProductNFT", "PROD")
        Ownable(msg.sender) // 初始化 Ownable
    {
        require(_rolesAddress != address(0) && _warrantyManagerAddress != address(0), "Invalid address");
        
        rolesContract = IRolesContract(_rolesAddress);
        warrantyManager = IWarrantyManager(_warrantyManagerAddress);
    }

    // setMarketplaceAddress：设置 Marketplace 地址并授予其权限。
    function setMarketplaceAddress(address _marketplaceAddress) public override onlyOwner { // 权限增强: 仅限 Owner 调用
        // 只能设置一次。
        require(marketplaceContract == address(0), "Registry: Marketplace already set.");
        require(_marketplaceAddress != address(0), "Registry: Invalid address.");
        
        marketplaceContract = _marketplaceAddress;

        // 授予 Marketplace 对本合约的全局操作权限 (ERC721 ApprovedForAll)。
        // 只有 Owner 可以授予此权限。
        _setApprovalForAll(owner(), _marketplaceAddress, true); 
    }
    
    // mintProduct：铸造新的产品 NFT。只能由 Marketplace 调用。(未修改)
    function mintProduct(
        address to, 
        string memory serialNumber, 
        string memory modelDetails, 
        string memory manufacturerDetails, 
        uint256 price, 
        string memory warrantyTermsURI 
    ) external onlyMarketplace override returns (uint256 tokenId) {
        // ... (内容未修改)
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        
        staticData[tokenId] = ProductStaticData({
            serialNumber: serialNumber,
            modelDetails: modelDetails,
            manufacturerDetails: manufacturerDetails,
            warrantyTermsURI: warrantyTermsURI,
            timeStamp: block.timestamp
        });
        
        marketInfo[tokenId].price = price;
        marketInfo[tokenId].isListed = true;
        
        return tokenId;
    }

    // updateMarketInfo：更新产品的价格和上架状态。只能由 Marketplace 调用。(未修改)
    function updateMarketInfo(
        uint256 productId, 
        uint256 price, 
        bool isListed 
    ) external onlyMarketplace override {
        marketInfo[productId].price = price;
        marketInfo[productId].isListed = isListed;
    }

    // recordOwnershipTransfer：记录产品的所有权流转事件。只能由 Marketplace 调用。(未修改)
    function recordOwnershipTransfer(
        uint256 productId, 
        address from, 
        address to, 
        string memory eventType 
    ) external onlyMarketplace override {
        ownershipHistory[productId].push(TransferLog({
            from: from,
            to: to,
            timestamp: block.timestamp,
            eventType: eventType
        }));
    }
    
    // ownerOf：ERC721 标准函数，查询产品 NFT 的所有者。(未修改)
    function ownerOf(uint256 tokenId) public view override(ERC721, IProductRegistry) returns (address) {
        return super.ownerOf(tokenId);
    }

    // transferFrom：覆盖原生 ERC721 转账。
    function transferFrom(address from, address to, uint256 tokenId) public virtual override(ERC721, IProductRegistry) {
        // 业务逻辑：如果转账双方中任一方拥有角色 (制造商/零售商/服务中心)，则允许原生转账。
        if (rolesContract.hasAnyRole(from) || rolesContract.hasAnyRole(to)) {
            super.transferFrom(from, to, tokenId);
        } else {
            // 如果双方都是普通客户 (Customer)，强制要求使用 restrictedTransferFrom。
            revert("ERC721: Use restrictedTransferFrom for non-role accounts.");
        }
    }

    // safeTransferFrom：覆盖原生 ERC721 安全转账（4参数）。(未修改)
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public virtual override(ERC721) {
        // 业务逻辑：权限逻辑同 transferFrom，只允许角色用户使用原生安全转账。
        if (rolesContract.hasAnyRole(from) || rolesContract.hasAnyRole(to)) {
            super.safeTransferFrom(from, to, tokenId, data);
        } else {
            revert("ERC721: Use restrictedTransferFrom for non-role accounts.");
        }
    }

    // restrictedTransferFrom：用于客户间的自定义转账函数。
    function restrictedTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        // **ERC721 权限检查：** 确保调用者是所有者或被授权人 (Marketplace)。
        require(
            _isApprovedOrOwner(msg.sender, tokenId),
            "ERC721: caller is not token owner or approved"
        );
        
        // ----------------------------------------------------------------------
        // **[关键修改]：移除保修转让限制**
        // 允许客户 (C) 在保修期内将产品转售给新客户 (C')，保修随 NFT 转移。
        // ----------------------------------------------------------------------
        
        // 执行实际的 ERC721 所有权转移。
        _transfer(from, to, tokenId);
    }

    // _isApprovedOrOwner：辅助函数，封装 OpenZeppelin 内部的权限检查逻辑。(未修改)
    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        return super.getApproved(tokenId) == spender || isApprovedForAll(ownerOf(tokenId), spender) || ownerOf(tokenId) == spender;
    }
    
    // getOwnershipHistory：提供外部查询产品流转历史的视图函数。(未修改)
    function getOwnershipHistory(uint256 productId) external view returns (TransferLog[] memory) {
        return ownershipHistory[productId];
    }
}