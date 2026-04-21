import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import fs from 'fs'
import path from 'path'
import { hostname } from 'os'
import { buildConfig, buildConfigBuffer } from '../../../third-party/dt-grpc-ts/flatbuf-config'
import { decodeDTTensor } from './image-decoder'
import { log, logApiRequest, logApiResponse } from '../logger'
import { Task } from '../../shared/types'
import { resolveModelsDir } from '../local-cli'

const PROTO_CONTENT = `syntax = "proto3";

service ImageGenerationService {
  rpc GenerateImage(ImageGenerationRequest) returns (stream ImageGenerationResponse);
  rpc FilesExist(FileListRequest) returns (FileExistenceResponse);
  rpc UploadFile(stream FileUploadRequest) returns (stream UploadResponse);
  rpc Echo(EchoRequest) returns (EchoReply);
  rpc Pubkey(PubkeyRequest) returns (PubkeyResponse);
  rpc Hours(HoursRequest) returns (HoursResponse);
}

message EchoRequest {
  string name = 1;
  optional string sharedSecret = 2;
}

message ComputeUnitThreshold {
  double community = 1;
  double plus = 2;
  int64 expireAt = 3;
}

message EchoReply {
  string message = 1;
  repeated string files = 2;
  optional MetadataOverride override = 3;
  bool sharedSecretMissing = 4;
  optional ComputeUnitThreshold thresholds = 5;
  uint64 serverIdentifier = 6;
}

message FileListRequest {
  repeated string files = 1;
  repeated string filesWithHash = 2;
  optional string sharedSecret = 3;
}

message FileExistenceResponse {
  repeated string files = 1;
  repeated bool existences = 2;
  repeated bytes hashes = 3;
}

message MetadataOverride {
  bytes models = 1;
  bytes loras = 2;
  bytes controlNets = 3;
  bytes textualInversions = 4;
  bytes upscalers = 5;
}

enum DeviceType {
  PHONE = 0;
  TABLET = 1;
  LAPTOP = 2;
}

message ImageGenerationRequest {
  optional bytes image = 1;
  int32 scaleFactor = 2;
  optional bytes mask = 3;
  repeated HintProto hints = 4;
  string prompt = 5;
  string negativePrompt = 6;
  bytes configuration = 7;
  MetadataOverride override = 8;
  repeated string keywords = 9;
  string user = 10;
  DeviceType device = 11;
  repeated bytes contents = 12;
  optional string sharedSecret = 13;
  bool chunked = 14;
}

message HintProto {
  string hintType = 1;
  repeated TensorAndWeight tensors = 2;
}

message TensorAndWeight {
  bytes tensor = 1;
  float weight = 2;
}

message ImageGenerationSignpostProto {
  message TextEncoded {}
  message ImageEncoded {}
  message Sampling {
    int32 step = 1;
  }
  message ImageDecoded {}
  message SecondPassImageEncoded {}
  message SecondPassSampling {
    int32 step = 1;
  }
  message SecondPassImageDecoded {}
  message FaceRestored {}
  message ImageUpscaled {}
  oneof signpost {
    TextEncoded textEncoded = 1;
    ImageEncoded imageEncoded = 2;
    Sampling sampling = 3;
    ImageDecoded imageDecoded = 4;
    SecondPassImageEncoded secondPassImageEncoded = 5;
    SecondPassSampling secondPassSampling = 6;
    SecondPassImageDecoded secondPassImageDecoded = 7;
    FaceRestored faceRestored = 8;
    ImageUpscaled imageUpscaled = 9;
  }
}

enum ChunkState {
  LAST_CHUNK = 0;
  MORE_CHUNKS = 1;
}

message RemoteDownloadResponse {
  int64 bytesReceived = 1;
  int64 bytesExpected = 2;
  int32 item = 3;
  int32 itemsExpected = 4;
  string tag = 5;
}

message ImageGenerationResponse {
  repeated bytes generatedImages = 1;
  optional ImageGenerationSignpostProto currentSignpost = 2;
  repeated ImageGenerationSignpostProto signposts = 3;
  optional bytes previewImage = 4;
  optional int32 scaleFactor = 5;
  repeated string tags = 6;
  optional int64 downloadSize = 7;
  ChunkState chunkState = 8;
  optional RemoteDownloadResponse remoteDownload = 9;
  repeated bytes generatedAudio = 10;
}

message FileChunk {
  bytes content = 1;
  string filename = 2;
  int64 offset = 3;
}

message InitUploadRequest {
  string filename = 1;
  bytes sha256 = 2;
  int64 totalSize = 3;
}

message UploadResponse {
  bool chunkUploadSuccess = 1;
  int64 receivedOffset = 2;
  string message = 3;
  string filename = 4;
}

message FileUploadRequest {
  oneof request {
    InitUploadRequest initRequest = 1;
    FileChunk chunk = 2;
  }
  optional string sharedSecret = 3;
}

message PubkeyRequest {
  string name = 1;
}

message PubkeyResponse {
  string message = 1;
  string pubkey = 2;
}

message HoursRequest {}

message HoursResponse {
  ComputeUnitThreshold thresholds = 1;
}
`

const PROTO_FILE_PATH = path.join(__dirname, 'imagequeue-imageService.proto')

function getProtoPath(): string {
  if (!fs.existsSync(PROTO_FILE_PATH)) {
    fs.writeFileSync(PROTO_FILE_PATH, PROTO_CONTENT, 'utf-8')
  }
  return PROTO_FILE_PATH
}

type GrpcClient = InstanceType<grpc.ServiceClientConstructor>
let _client: GrpcClient | null = null

function getClient(): GrpcClient {
  if (_client) return _client

  const packageDef = protoLoader.loadSync(getProtoPath(), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grpcPkg = grpc.loadPackageDefinition(packageDef) as any
  _client = new grpcPkg.ImageGenerationService(
    'localhost:7859',
    grpc.credentials.createInsecure(),
    {
      'grpc.max_receive_message_length': 100 * 1024 * 1024,
      'grpc.max_send_message_length': 100 * 1024 * 1024,
    }
  )
  return _client!
}

export function resetClient(): void {
  _client = null
}

// resolveModelsDir is imported but used only in generateDrawThings (drawthings.ts).
// Re-export here so callers don't need a separate import.
export { resolveModelsDir }

export async function generateImageGrpc(task: Task): Promise<Buffer> {
  const client = getClient()

  const steps = (task.params.steps as number) || 4
  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024
  const seed = (task.params.seed as number | null) ?? -1
  const cfg = (task.params.cfg as number) || 1
  const negativePrompt = (task.params.negativePrompt as string) || ''

  const configBuffer = buildConfigBuffer(buildConfig({
    model: task.model,
    steps,
    width,
    height,
    seed: seed > 0 ? seed : -1,
    guidanceScale: cfg,
  }))

  const request = {
    scaleFactor: 1,
    user: hostname(),
    device: 2, // LAPTOP
    configuration: Buffer.from(configBuffer),
    prompt: task.prompt,
    negativePrompt,
    hints: [],
    contents: [],
  }

  logApiRequest('drawthings-grpc', 'GenerateImage', {
    model: task.model, steps, width, height, seed, cfg
  })
  const startTime = Date.now()

  return new Promise<Buffer>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (client as any).GenerateImage(request)
    const images: Buffer[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on('data', (response: any) => {
      if (response.generatedImages && response.generatedImages.length > 0) {
        for (const img of response.generatedImages) {
          images.push(Buffer.isBuffer(img) ? img : Buffer.from(img))
        }
      }
    })

    call.on('error', (err: Error & { code?: number; details?: string }) => {
      const statusCode = err.code !== undefined ? grpc.status[err.code] ?? err.code : undefined
      const detail = err.details || err.message
      const message = statusCode ? `gRPC ${statusCode}: ${detail}` : detail
      log('error', 'gRPC GenerateImage failed', { code: statusCode, details: err.details, message: err.message })
      reject(new Error(message))
    })

    call.on('end', () => {
      if (images.length === 0) {
        reject(new Error(`gRPC server returned no images (model: ${task.model})`))
        return
      }
      try {
        const pngBuffer = decodeDTTensor(images[0])
        logApiResponse('drawthings-grpc', 'ok', Date.now() - startTime)
        resolve(pngBuffer)
      } catch (err) {
        reject(err)
      }
    })
  })
}
