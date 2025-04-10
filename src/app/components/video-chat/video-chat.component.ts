import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { VideoChatService } from '../../services/video-chat.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-video-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './video-chat.component.html',
  styleUrl: './video-chat.component.scss'
})
export class VideoChatComponent implements OnInit, OnDestroy {
  @ViewChild('webcamVideo', { static: false }) webcamVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo', { static: false }) remoteVideo!: ElementRef<HTMLVideoElement>;

  callId: string = '';
  webcamButtonDisabled = false;
  callButtonDisabled = true;
  answerButtonDisabled = true;
  hangupButtonDisabled = true;

  private subscriptions: Subscription[] = [];

  constructor(private videoChatService: VideoChatService) {}

  ngOnInit(): void {
    // Subscribe to stream changes
    this.subscriptions.push(
      this.videoChatService.localStream$.subscribe(stream => {
        if (stream && this.webcamVideo?.nativeElement) {
          this.webcamVideo.nativeElement.srcObject = stream;
        }
      }),
      this.videoChatService.remoteStream$.subscribe(stream => {
        if (stream && this.remoteVideo?.nativeElement) {
          this.remoteVideo.nativeElement.srcObject = stream;
        }
      })
    );
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.videoChatService.hangup();
  }

  async startWebcam(): Promise<void> {
    try {
      await this.videoChatService.setupMediaSources();
      this.webcamButtonDisabled = true;
      this.callButtonDisabled = false;
      this.answerButtonDisabled = false;
    } catch (error) {
      console.error('Error starting webcam:', error);
    }
  }

  async createCall(): Promise<void> {
    try {
      this.callId = await this.videoChatService.createCall();
      this.hangupButtonDisabled = false;
    } catch (error) {
      console.error('Error creating call:', error);
    }
  }

  async answerCall(): Promise<void> {
    if (!this.callId.trim()) {
      alert('Please enter a call ID');
      return;
    }

    try {
      await this.videoChatService.answerCall(this.callId);
      this.hangupButtonDisabled = false;
    } catch (error) {
      console.error('Error answering call:', error);
      alert('Failed to join call. Please check the call ID and try again.');
    }
  }

  hangup(): void {
    this.videoChatService.hangup();
    this.resetUI();
  }

  private resetUI(): void {
    this.webcamButtonDisabled = false;
    this.callButtonDisabled = true;
    this.answerButtonDisabled = true;
    this.hangupButtonDisabled = true;
    this.callId = '';
  }
}
