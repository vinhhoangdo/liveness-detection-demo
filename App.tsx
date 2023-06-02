import { Dimensions, SafeAreaView, StyleSheet, Text, View } from "react-native"
import * as React from "react"
import * as FaceDetector from "expo-face-detector"
import MaskedView from "@react-native-masked-view/masked-view"
import { Camera, CameraType, FaceDetectionResult } from "expo-camera"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { contains, Rect } from "./contains"
const { width: windowWidth } = Dimensions.get("window")


const PREVIEW_SIZE = 300
const PREVIEW_RECT: Rect = {
  minX: (windowWidth - PREVIEW_SIZE) / 2,
  minY: 50,
  width: PREVIEW_SIZE,
  height: PREVIEW_SIZE
}




const instructionsText = {
  initialPrompt: "Position your face in the circle",
  performActions: "Keep the device still and perform the following actions.",
  tooClose: "You're too close. Hold the device further."
}



const detections = {
  BLINK: { instruction: "Blink both eyes", minProbability: 0.3 },
  TURN_HEAD_LEFT: { instruction: "Turn head left", maxAngle: -15 },
  TURN_HEAD_RIGHT: { instruction: "Turn head right", maxAngle: 15 },
  NOD: { instruction: "Nod", minDiff: 1.5 },
  SMILE: { instruction: "Smile", minProbability: 0.7 }
}

type DetectionActions = keyof typeof detections

const detectionsList: DetectionActions[] = [
  "BLINK",
  "TURN_HEAD_LEFT",
  "TURN_HEAD_RIGHT",
  "NOD",
  "SMILE"
]

const initialState = {
  faceDetected: "no" as "yes" | "no",
  faceTooBig: "no" as "yes" | "no",
  detectionsList,
  currentDetectionIndex: 0,
  progressFill: 0,
  processComplete: false
}

export default function App() {
  const [state, dispatch] = React.useReducer(detectionReducer, initialState)

  const rollAngles = React.useRef<number[]>([])
  const [hasPermission, setHasPermission] = React.useState(false);

  React.useEffect(() => {
    const requestPermissions = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync()
      setHasPermission(status == "granted")
    }

    requestPermissions()
  }, [])

  const angleCalib = (angle: number) => {
    return angle > 180 ? angle - 360 : angle
  }

  const onFacesDetected = (result: FaceDetectionResult) => {
    // 1. There is only a single face in the detection results.
    if (result.faces.length !== 1) {
      dispatch({ type: "FACE_DETECTED", payload: "no" })
      return
    }

    const face: FaceDetector = result.faces[0] as FaceDetector

    // The Angles in android are from 0 to 360, but in ios, they're from -180 to +180!
    face.yawAngle = angleCalib(face.yawAngle)
    face.rollAngle = angleCalib(face.rollAngle)


    const faceRect: Rect = {
      minX: face.bounds.origin.x,
      minY: face.bounds.origin.y,
      width: face.bounds.size.width,
      height: face.bounds.size.height
    }

    // 2. The face is fully contained within the camera preview
    const edgeOffset = 50
    const faceRectSmaller = {
      ...faceRect,
      width: faceRect.width - edgeOffset,
      height: faceRect.height - edgeOffset,
    }
    const previewContainsFace = contains({
      outside: PREVIEW_RECT,
      inside: faceRectSmaller
    })

    if (!previewContainsFace) {
      dispatch({ type: "FACE_DETECTED", payload: "no" })
      return
    }

    if (state.faceDetected === "no") {
      // 3. The face is not as big as te camera preview.
      const faceMaxSize = PREVIEW_SIZE - 90
      if (faceRect.width >= faceMaxSize && faceRect.height >= faceMaxSize) {
        dispatch({ type: "FACE_TOO_BIG", payload: "yes" })
        return
      }
      if (state.faceTooBig === "yes") {
        dispatch({ type: "FACE_TOO_BIG", payload: "no" })
      }
    }
    if (state.faceDetected === "no") {
      dispatch({ type: "FACE_DETECTED", payload: "yes" })
    }

    const detectionAction = state.detectionsList[state.currentDetectionIndex]

    switch (detectionAction) {
      case "BLINK":
        //Lower probability is when eyes are closed
        const leftEyeClosed = face.leftEyeOpenProbability <= detections.BLINK.minProbability
        const rightEyeClosed = face.rightEyeOpenProbability <= detections.BLINK.minProbability
        if (leftEyeClosed && rightEyeClosed) {
          dispatch({ type: "NEXT_DETECTION", payload: null })
        }
        return
      case "NOD":
        //Collect roll angle data in ref
        rollAngles.current.push(face.rollAngle)
        //Don't keep more than 10 roll angles (10 detection frames)
        if (rollAngles.current.length > 50) {
          rollAngles.current.shift()
        }
        //If not enough roll angle data, then don't process
        if (rollAngles.current.length < 50) return

        //Calculate avg from collected data, expect current angle data
        const rollAnglesExceptCurrent = [...rollAngles.current].splice(
          0,
          rollAngles.current.length - 1
        )

        //Simulation
        const rollAnglesSum = rollAnglesExceptCurrent.reduce((prev, curr) => {
          return prev + Math.abs(curr)
        }, 0)

        // Average
        const avgAngle = rollAnglesSum / rollAnglesExceptCurrent.length

        // If the difference between the current angle and the average is above thresshold, pass.
        const diff = Math.abs(avgAngle - Math.abs(face.rollAngle))
        console.log("DIFF: " + diff)
        if (diff >= detections.NOD.minDiff) {
          dispatch({ type: "NEXT_DETECTION", payload: null })
        }
        return

      case "TURN_HEAD_LEFT":
        // Negative angle is the when the face turns left
        console.log("TURN_HEAD_LEFT " + face.yawAngle)
        if (face.yawAngle <= detections.TURN_HEAD_LEFT.maxAngle) {
          dispatch({ type: "NEXT_DETECTION", payload: null })
        }
        return
      case "TURN_HEAD_RIGHT":
        // Positive angle is the when the face turns right
        console.log("TURN_HEAD_RIGHT " + face.yawAngle)
        if (face.yawAngle >= detections.TURN_HEAD_RIGHT.maxAngle) {
          dispatch({ type: "NEXT_DETECTION", payload: null })
        }
        return
      case "SMILE":
        // Higher probability is when smiling
        if (face.smilingProbability >= detections.SMILE.minProbability) {
          dispatch({ type: "NEXT_DETECTION", payload: null })
        }
        return
    }
  }

  React.useEffect(() => {
    if (state.processComplete) {

      setTimeout(() => {
        console.log("SUCCESSFULL!")
      }, 500)
    }
  }, [state.processComplete])

  if (hasPermission === false) {
    return <Text>No access to camera</Text>
  }

  return (
    <SafeAreaView style={StyleSheet.absoluteFill}>
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={<View style={styles.mask} />}
      >
        <Camera
          style={StyleSheet.absoluteFill}
          type={CameraType.front}
          onFacesDetected={onFacesDetected}
          faceDetectorSettings={{
            mode: FaceDetector.FaceDetectorMode.fast, //ignore faces in the background
            detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
            runClassifications: FaceDetector.FaceDetectorClassifications.all,
            minDetectionInterval: 125,
            tracking: false
          }}
        >

          <AnimatedCircularProgress
            style={styles.circularProgress}
            size={PREVIEW_SIZE}
            width={5}
            backgroundWidth={7}
            fill={state.progressFill}
            tintColor="#3485FF"
            backgroundColor="#e8e8e8"
          />
        </Camera>

      </MaskedView>
      <View style={styles.instructionsContainer}>
        <Text style={styles.instructions}>
          {state.faceDetected === "no" && state.faceTooBig === "no" &&
            instructionsText.initialPrompt}
          {state.faceTooBig === "yes" && instructionsText.tooClose}
          {state.faceDetected === "yes" &&
            state.faceTooBig === "yes" &&
            instructionsText.performActions}
        </Text>
        <Text style={styles.action}>
          {state.faceDetected === "yes" && state.faceTooBig === "no" &&
            detections[state.detectionsList[state.currentDetectionIndex]].instruction}
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  mask: {
    borderRadius: PREVIEW_SIZE / 2,
    height: PREVIEW_SIZE,
    width: PREVIEW_SIZE,
    marginTop: PREVIEW_RECT.minY,
    alignSelf: "center",
    backgroundColor: "white"
  },
  circularProgress: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    marginTop: PREVIEW_RECT.minY,
    marginLeft: PREVIEW_RECT.minX
  },
  instructions: {
    fontSize: 20,
    textAlign: "center",
    top: 25,
    position: "absolute"
  },
  instructionsContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: PREVIEW_RECT.minY + PREVIEW_SIZE
  },
  action: {
    fontSize: 24,
    textAlign: "center",
    fontWeight: "bold"
  }
})

interface FaceDetector {
  rollAngle: number
  yawAngle: number
  smilingProbability: number
  leftEyeOpenProbability: number
  rightEyeOpenProbability: number
  bounds: {
    origin: {
      x: number
      y: number
    }
    size: {
      width: number
      height: number
    }
  }
}

interface Actions {
  FACE_DETECTED: "yes" | "no",
  FACE_TOO_BIG: "yes" | "no",
  NEXT_DETECTION: null
}

interface Action<T extends keyof Actions> {
  type: T
  payload: Actions[T]
}

type PossibleActions = {
  [K in keyof Actions]: Action<K>
}[keyof Actions]

const detectionReducer = (
  state: typeof initialState,
  action: PossibleActions
): typeof initialState => {
  switch (action.type) {
    case "FACE_DETECTED":
      if (action.payload === "yes") {
        return {
          ...state,
          faceDetected: action.payload,
          progressFill: 100 / (state.detectionsList.length + 1)
        }
      } else {
        //Reset
        return initialState
      }
    case "FACE_TOO_BIG":
      return { ...state, faceTooBig: action.payload }
    case "NEXT_DETECTION":
      // Next detection index
      const nextDetectionIndex = state.currentDetectionIndex + 1

      // Skip 0 index
      const progressMultiplier = nextDetectionIndex + 1

      const newProgressFill = (100 / (state.detectionsList.length + 1)) * progressMultiplier

      if (nextDetectionIndex === state.detectionsList.length) {
        // Paused
        return { ...state, processComplete: true, progressFill: newProgressFill }
      }

      //Next detection
      return {
        ...state,
        currentDetectionIndex: nextDetectionIndex,
        progressFill: newProgressFill
      }
    default:
      throw new Error("Unexpected action type.")
  }
}