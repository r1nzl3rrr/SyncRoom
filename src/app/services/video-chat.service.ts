import { inject, Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  doc,
  Firestore,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc
} from '@angular/fire/firestore';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment.development';

@Injectable({
  providedIn: 'root'
})
export class VideoChatService {
  private firestore: Firestore = inject(Firestore);
  private peerConnection: RTCPeerConnection | null = null;
  private localStreamSource = new BehaviorSubject<MediaStream | null>(null);
  private remoteStreamSource = new BehaviorSubject<MediaStream | null>(null);

  localStream$ = this.localStreamSource.asObservable();
  remoteStream$ = this.remoteStreamSource.asObservable();

  async setupMediaSources(): Promise<void> {
    const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const remoteStream = new MediaStream();

    this.localStreamSource.next(localStream);
    this.remoteStreamSource.next(remoteStream);

    // Initialize peer connection
    this.peerConnection = new RTCPeerConnection(environment.servers);

    // Push tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
      if (this.peerConnection) {
        this.peerConnection.addTrack(track, localStream);
      }
    });

    // Pull tracks from remote stream, add to video stream
    this.peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    return Promise.resolve();
  }

  async createCall(): Promise<string> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    // Reference Firestore collections for signaling
    const callsCollection = collection(this.firestore, 'calls');
    const callDoc = doc(callsCollection);
    const callId = callDoc.id;
    
    const offerCandidatesCollection = collection(callDoc, 'offerCandidates');
    const answerCandidatesCollection = collection(callDoc, 'answerCandidates');

    // Get candidates for caller, save to db
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(offerCandidatesCollection, event.candidate.toJSON());
      }
    };

    // Create offer
    const offerDescription = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    };

    await setDoc(callDoc, { offer });

    // Listen for remote answer
    onSnapshot(callDoc, (snapshot) => {
      const data = snapshot.data();
      if (!this.peerConnection?.currentRemoteDescription && data?.['answer']) {
        const answerDescription = new RTCSessionDescription(data['answer']);
        this.peerConnection?.setRemoteDescription(answerDescription);
      }
    });

    // When answered, add candidate to peer connection
    onSnapshot(answerCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          this.peerConnection?.addIceCandidate(candidate);
        }
      });
    });

    return callId;
  }

  async answerCall(callId: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const callDoc = doc(this.firestore, 'calls', callId);
    const answerCandidatesCollection = collection(callDoc, 'answerCandidates');
    const offerCandidatesCollection = collection(callDoc, 'offerCandidates');

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(answerCandidatesCollection, event.candidate.toJSON());
      }
    };

    const callSnapshot = await getDoc(callDoc);
    const callData = callSnapshot.data();

    if (!callData) {
      throw new Error('Call not found');
    }

    const offerDescription = callData['offer'];
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };

    await updateDoc(callDoc, { answer });

    onSnapshot(offerCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          this.peerConnection?.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  }

  hangup(): void {
    // Close connections and reset state
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    // Stop all tracks in the local stream
    const localStream = this.localStreamSource.value;
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      this.localStreamSource.next(null);
    }
    
    this.remoteStreamSource.next(null);
  }
}