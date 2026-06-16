"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchProcessor = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const openai_1 = __importDefault(require("openai"));
const logger_1 = require("../utils/logger");
const metadata_generator_1 = require("./metadata-generator");
class BatchProcessor {
    constructor(options) {
        this.client = new openai_1.default({ apiKey: options.apiKey });
        this.generator = new metadata_generator_1.MetadataGenerator(options.apiKey, options.model);
        this.batchSize = options.batchSize || 100;
        this.outputDir = options.outputDir || './temp';
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }
    async processTemplates(templates, progressCallback) {
        const results = new Map();
        const batches = this.createBatches(templates);
        logger_1.logger.info(`Processing ${templates.length} templates in ${batches.length} batches`);
        console.log(`\n📤 Submitting ${batches.length} batch${batches.length > 1 ? 'es' : ''} to OpenAI...`);
        const batchJobs = [];
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const batchNum = i + 1;
            try {
                progressCallback?.(`Submitting batch ${batchNum}/${batches.length}`, i * this.batchSize, templates.length);
                const jobPromise = this.submitBatch(batch, `batch_${batchNum}`);
                batchJobs.push({ batchNum, jobPromise, templates: batch });
                console.log(`   📨 Submitted batch ${batchNum}/${batches.length} (${batch.length} templates)`);
            }
            catch (error) {
                logger_1.logger.error(`Error submitting batch ${batchNum}:`, error);
                console.error(`   ❌ Failed to submit batch ${batchNum}`);
            }
        }
        console.log(`\n⏳ All batches submitted. Waiting for completion...`);
        console.log(`   (Batches process in parallel - this is much faster than sequential processing)`);
        const batchPromises = batchJobs.map(async ({ batchNum, jobPromise, templates: batchTemplates }) => {
            try {
                const completedJob = await jobPromise;
                console.log(`\n📦 Retrieving results for batch ${batchNum}/${batches.length}...`);
                const batchResults = await this.retrieveResults(completedJob);
                logger_1.logger.info(`Retrieved ${batchResults.length} results from batch ${batchNum}`);
                progressCallback?.(`Retrieved batch ${batchNum}/${batches.length}`, Math.min(batchNum * this.batchSize, templates.length), templates.length);
                return { batchNum, results: batchResults };
            }
            catch (error) {
                logger_1.logger.error(`Error processing batch ${batchNum}:`, error);
                console.error(`   ❌ Batch ${batchNum} failed:`, error);
                return { batchNum, results: [] };
            }
        });
        const allBatchResults = await Promise.all(batchPromises);
        for (const { batchNum, results: batchResults } of allBatchResults) {
            for (const result of batchResults) {
                results.set(result.templateId, result);
            }
            if (batchResults.length > 0) {
                console.log(`   ✅ Merged ${batchResults.length} results from batch ${batchNum}`);
            }
        }
        logger_1.logger.info(`Batch processing complete: ${results.size} results`);
        return results;
    }
    async submitBatch(templates, batchName) {
        const inputFile = await this.createBatchFile(templates, batchName);
        try {
            const uploadedFile = await this.uploadFile(inputFile);
            const batchJob = await this.createBatchJob(uploadedFile.id);
            const monitoringPromise = this.monitorBatchJob(batchJob.id);
            try {
                fs.unlinkSync(inputFile);
            }
            catch { }
            monitoringPromise.then(async (completedJob) => {
                try {
                    await this.client.files.delete(uploadedFile.id);
                    if (completedJob.output_file_id) {
                    }
                }
                catch (error) {
                    logger_1.logger.warn(`Failed to cleanup files for batch ${batchName}`, error);
                }
            });
            return monitoringPromise;
        }
        catch (error) {
            try {
                fs.unlinkSync(inputFile);
            }
            catch { }
            throw error;
        }
    }
    async processBatch(templates, batchName) {
        const inputFile = await this.createBatchFile(templates, batchName);
        try {
            const uploadedFile = await this.uploadFile(inputFile);
            const batchJob = await this.createBatchJob(uploadedFile.id);
            const completedJob = await this.monitorBatchJob(batchJob.id);
            const results = await this.retrieveResults(completedJob);
            await this.cleanup(inputFile, uploadedFile.id, completedJob.output_file_id);
            return results;
        }
        catch (error) {
            try {
                fs.unlinkSync(inputFile);
            }
            catch { }
            throw error;
        }
    }
    createBatches(templates) {
        const batches = [];
        for (let i = 0; i < templates.length; i += this.batchSize) {
            batches.push(templates.slice(i, i + this.batchSize));
        }
        return batches;
    }
    async createBatchFile(templates, batchName) {
        const filename = path.join(this.outputDir, `${batchName}_${Date.now()}.jsonl`);
        const stream = fs.createWriteStream(filename);
        for (const template of templates) {
            const request = this.generator.createBatchRequest(template);
            stream.write(JSON.stringify(request) + '\n');
        }
        stream.end();
        await new Promise((resolve, reject) => {
            stream.on('finish', () => resolve());
            stream.on('error', reject);
        });
        logger_1.logger.debug(`Created batch file: ${filename} with ${templates.length} requests`);
        return filename;
    }
    async uploadFile(filepath) {
        const file = fs.createReadStream(filepath);
        const uploadedFile = await this.client.files.create({
            file,
            purpose: 'batch'
        });
        logger_1.logger.debug(`Uploaded file: ${uploadedFile.id}`);
        return uploadedFile;
    }
    async createBatchJob(fileId) {
        const batchJob = await this.client.batches.create({
            input_file_id: fileId,
            endpoint: '/v1/chat/completions',
            completion_window: '24h'
        });
        logger_1.logger.info(`Created batch job: ${batchJob.id}`);
        return batchJob;
    }
    async monitorBatchJob(batchId) {
        const pollInterval = 60;
        let attempts = 0;
        const maxAttempts = 120;
        const startTime = Date.now();
        let lastStatus = '';
        while (attempts < maxAttempts) {
            const batchJob = await this.client.batches.retrieve(batchId);
            const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
            const statusSymbol = batchJob.status === 'in_progress' ? '⚙️' :
                batchJob.status === 'finalizing' ? '📦' :
                    batchJob.status === 'validating' ? '🔍' :
                        batchJob.status === 'completed' ? '✅' :
                            batchJob.status === 'failed' ? '❌' : '⏳';
            console.log(`   ${statusSymbol} Batch ${batchId.slice(-8)}: ${batchJob.status} (${elapsedMinutes} min, check ${attempts + 1})`);
            if (batchJob.status !== lastStatus) {
                logger_1.logger.info(`Batch ${batchId} status changed: ${lastStatus} -> ${batchJob.status}`);
                lastStatus = batchJob.status;
            }
            if (batchJob.status === 'completed') {
                console.log(`   ✅ Batch ${batchId.slice(-8)} completed successfully in ${elapsedMinutes} minutes`);
                logger_1.logger.info(`Batch job ${batchId} completed successfully`);
                return batchJob;
            }
            if (['failed', 'expired', 'cancelled'].includes(batchJob.status)) {
                logger_1.logger.error(`Batch job ${batchId} failed with status: ${batchJob.status}`);
                throw new Error(`Batch job failed with status: ${batchJob.status}`);
            }
            logger_1.logger.debug(`Waiting ${pollInterval} seconds before next check...`);
            await this.sleep(pollInterval * 1000);
            attempts++;
        }
        throw new Error(`Batch job monitoring timed out after ${maxAttempts} minutes`);
    }
    async retrieveResults(batchJob) {
        const results = [];
        if (batchJob.output_file_id) {
            const fileResponse = await this.client.files.content(batchJob.output_file_id);
            const fileContent = await fileResponse.text();
            const lines = fileContent.trim().split('\n');
            for (const line of lines) {
                if (!line)
                    continue;
                try {
                    const result = JSON.parse(line);
                    const parsed = this.generator.parseResult(result);
                    results.push(parsed);
                }
                catch (error) {
                    logger_1.logger.error('Error parsing result line:', error);
                }
            }
            logger_1.logger.info(`Retrieved ${results.length} successful results from batch job`);
        }
        if (batchJob.error_file_id) {
            logger_1.logger.warn(`Batch job has error file: ${batchJob.error_file_id}`);
            try {
                const errorResponse = await this.client.files.content(batchJob.error_file_id);
                const errorContent = await errorResponse.text();
                const errorFilePath = path.join(this.outputDir, `batch_${batchJob.id}_error.jsonl`);
                fs.writeFileSync(errorFilePath, errorContent);
                logger_1.logger.warn(`Error file saved to: ${errorFilePath}`);
                const errorLines = errorContent.trim().split('\n');
                logger_1.logger.warn(`Found ${errorLines.length} failed requests in error file`);
                for (const line of errorLines) {
                    if (!line)
                        continue;
                    try {
                        const errorResult = JSON.parse(line);
                        const templateId = parseInt(errorResult.custom_id?.replace('template-', '') || '0');
                        if (templateId > 0) {
                            const errorMessage = errorResult.response?.body?.error?.message ||
                                errorResult.error?.message ||
                                'Unknown error';
                            logger_1.logger.debug(`Template ${templateId} failed: ${errorMessage}`);
                            const defaultMeta = this.generator.getDefaultMetadata();
                            results.push({
                                templateId,
                                metadata: defaultMeta,
                                error: errorMessage
                            });
                        }
                    }
                    catch (parseError) {
                        logger_1.logger.error('Error parsing error line:', parseError);
                    }
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to process error file:', error);
            }
        }
        if (results.length === 0 && !batchJob.output_file_id && !batchJob.error_file_id) {
            throw new Error('No output file or error file available for batch job');
        }
        logger_1.logger.info(`Total results (successful + failed): ${results.length}`);
        return results;
    }
    async cleanup(localFile, inputFileId, outputFileId) {
        try {
            fs.unlinkSync(localFile);
            logger_1.logger.debug(`Deleted local file: ${localFile}`);
        }
        catch (error) {
            logger_1.logger.warn(`Failed to delete local file: ${localFile}`, error);
        }
        try {
            await this.client.files.delete(inputFileId);
            logger_1.logger.debug(`Deleted input file from OpenAI: ${inputFileId}`);
        }
        catch (error) {
            logger_1.logger.warn(`Failed to delete input file from OpenAI: ${inputFileId}`, error);
        }
        if (outputFileId) {
            try {
                await this.client.files.delete(outputFileId);
                logger_1.logger.debug(`Deleted output file from OpenAI: ${outputFileId}`);
            }
            catch (error) {
                logger_1.logger.warn(`Failed to delete output file from OpenAI: ${outputFileId}`, error);
            }
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.BatchProcessor = BatchProcessor;
//# sourceMappingURL=batch-processor.js.map