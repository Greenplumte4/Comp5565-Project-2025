// File: ProductRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./I_Interfaces.sol";

contract ProductRegistry is ERC721, IProductRegistry, Ownable {

    address public marketplaceContract;
    IRolesContract public rolesContract;
    IWarrantyManager public warrantyManager;

    // Token ID 从 1000 开始
    uint256 private _nextTokenId = 1000;

    mapping(string => uint256) public serialNumberToTokenId;

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

    // 用于前端展示的完整数据结构
    struct ProductVerificationData {
        uint256 tokenId;
        string serialNumber;
        string modelDetails;
        string manufacturerDetails;
        uint256 registrationTimestamp;
        uint256 currentPrice;
        bool isListed;
        address currentOwner;
        TransferLog[] ownershipHistory;
    }

    mapping(uint256 => ProductStaticData) public staticData;
    mapping(uint256 => MarketData) public marketInfo;
    
    // 【修复 1/2】: 将 public mapping 改为 internal，并改名 _ownershipHistory，防止 ethers.js 编译错误
    mapping(uint256 => TransferLog[]) internal _ownershipHistory; 

    modifier onlyMarketplace() {
        require(msg.sender == marketplaceContract, "Registry: Only Marketplace.");
        _;
    }

    constructor(address _rolesContract, address _warrantyManager)
        ERC721("ProductNFT", "PRD")
        Ownable(msg.sender)
    {
        require(_rolesContract != address(0) && _warrantyManager != address(0), "PR: Invalid address.");
        rolesContract = IRolesContract(_rolesContract);
        warrantyManager = IWarrantyManager(_warrantyManager);
    }

    function setMarketplaceAddress(address _marketplaceAddress) external onlyOwner override {
        require(marketplaceContract == address(0), "Registry: Marketplace already set.");
        marketplaceContract = _marketplaceAddress;
    }

    // --- 核心功能 ---

    function getProductMarketInfo(uint256 productId) external view override returns (uint256 price, bool isListed) {
        return (marketInfo[productId].price, marketInfo[productId].isListed);
    }

    function recordOwnershipTransfer(uint256 productId, address from, address to, string memory eventType) public onlyMarketplace override {
        // 【修复 2/2】: 使用 internal 变量名 _ownershipHistory
        _ownershipHistory[productId].push(TransferLog({
            from: from,
            to: to,
            timestamp: block.timestamp,
            eventType: eventType
        }));
    }

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

        serialNumberToTokenId[serialNumber] = tokenId;

        staticData[tokenId] = ProductStaticData({
            serialNumber: serialNumber,
            modelDetails: modelDetails,
            manufacturerDetails: manufacturerDetails,
            warrantyTermsURI: warrantyTermsURI,
            timeStamp: block.timestamp
        });

        // 默认设置为上架状态
        marketInfo[tokenId].price = price;
        marketInfo[tokenId].isListed = true;

        recordOwnershipTransfer(tokenId, address(0), to, "MINT_LISTED");

        return tokenId;
    }

    function updateMarketInfo(uint256 productId, uint256 price, bool isListed) external onlyMarketplace override {
        marketInfo[productId].price = price;
        marketInfo[productId].isListed = isListed;
    }

    // [关键] 市场交易专用转移函数：绕过 approve 检查，由 Marketplace 合约逻辑保证安全
    function executeMarketTransaction(address from, address to, uint256 tokenId) external onlyMarketplace override {
        _transfer(from, to, tokenId);
    }

    // --- 前端库存与验证功能 ---

    // [新增] 获取玩家库存：返回该地址拥有的所有 Token ID
    // 前端拿到 ID 数组后，循环调用 verifyProduct 获取详情即可
    function getPlayerInventory(address _owner) external view override returns (uint256[] memory) {
        uint256 tokenCount = balanceOf(_owner);
        if (tokenCount == 0) {
            return new uint256[](0);
        }

        uint256[] memory tokens = new uint256[](tokenCount);
        uint256 currentIndex = 0;

        // 遍历寻找属于该用户的 token (适用于作业规模的数据量)
        for (uint256 i = 1000; i < _nextTokenId; i++) {
            // 使用 internal _ownerOf 或者 public ownerOf (需 try-catch)
            // 简单起见，假设所有 ID 都存在
            try this.ownerOf(i) returns (address owner) {
                if (owner == _owner) {
                    tokens[currentIndex] = i;
                    currentIndex++;
                    if (currentIndex == tokenCount) {
                        break;
                    }
                }
            } catch {
                continue;
            }
        }
        return tokens;
    }

    function verifyProduct(uint256 _tokenId) public view returns (ProductVerificationData memory data) {
        try this.ownerOf(_tokenId) returns (address _owner) {
             require(_owner != address(0), "PR: Does not exist.");
        } catch {
             revert("PR: Does not exist.");
        }

        ProductStaticData memory staticD = staticData[_tokenId];
        MarketData memory marketD = marketInfo[_tokenId];
        
        // 【修复 2/2】: 使用 internal 变量名 _ownershipHistory
        TransferLog[] memory history = _ownershipHistory[_tokenId]; 
        
        address owner = ownerOf(_tokenId);

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

    // 重写 ownerOf 以暴露给接口
    function ownerOf(uint256 tokenId) public view override(ERC721, IProductRegistry) returns (address) {
        return super.ownerOf(tokenId);
    }
}