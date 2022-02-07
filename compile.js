const path = require('path')
const fs = require('fs')
const solc = require('solc')

const contractFileName = process.env.CONTRACT_FILE || 'bee.sol';
const inboxPath = path.resolve(__dirname, 'contract', contractFileName)
const source = fs.readFileSync(inboxPath, 'utf-8')

const input = {
    language: 'Solidity',
    sources: { [contractFileName]: { content: source } },
    settings: {
        outputSelection: {
            '*': {
                '*': ['*'],
            },
        },
    },
};

const Bee = JSON.parse(solc.compile(JSON.stringify(input))).contracts[contractFileName]['Bee']
const TokenTimelock = JSON.parse(solc.compile(JSON.stringify(input))).contracts[contractFileName]['TokenTimelock']
const TestTokenTimeLock = JSON.parse(solc.compile(JSON.stringify(input))).contracts[contractFileName]['TestTokenTimeLock']
module.exports = { Bee, TokenTimelock, TestTokenTimeLock }